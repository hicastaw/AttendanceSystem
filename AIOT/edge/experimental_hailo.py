"""Metadata-bound HailoRT InferModel transport, NOT a production face adapter.

No assumed SCRFD head order, NHWC conversion, normalization or dequantization.
FLOAT32 host format delegates quantization conversion to HailoRT. Tensor meaning
and CPU/HEF parity remain separate acceptance gates. No hardware auto-fallback.
"""
from contextlib import ExitStack
import copy
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import numpy as np


def architecture_from_cli(text):
    match=re.search(r'Architecture\s+HEF\s+was\s+compiled\s+for\s*:\s*(\w+)',text,re.I)
    if not match or match[1].upper()!='HAILO10H':raise ValueError('BLOCKED_ARCHITECTURE: require parsed HAILO10H, never infer from filename')
    return match[1].upper()


def inspect_hef(path,*,runtime=None,cli_output=None):
    path=Path(path)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if cli_output is None:
        cli=shutil.which('hailortcli')
        if cli is None:raise RuntimeError('BLOCKED_RUNTIME: hailortcli parse-hef unavailable')
        cli_output=subprocess.run([cli,'parse-hef',str(path)],check=True,capture_output=True,text=True,timeout=30).stdout
    architecture=architecture_from_cli(cli_output)
    if runtime is None:import hailo_platform as runtime
    hef=runtime.HEF(str(path))
    groups=hef.get_network_group_names()
    if len(groups)!=1:raise ValueError('Only a single explicit network group supported')
    def tensors(infos):
        result=[]
        for info in infos:
            shape=[int(n) for n in info.shape]
            if not shape or any(n<=0 for n in shape) or np.prod(shape)>8_000_000 or 'NMS' in str(info.format.order).upper():
                raise ValueError('Unsupported packed/NMS or unbounded tensor; requires actual postprocess specification')
            q=info.quant_info
            result.append(dict(name=info.name,shape=shape,format_type=str(info.format.type),format_order=str(info.format.order),
                               quantization=dict(zero_point=float(q.qp_zp),scale=float(q.qp_scale))))
        if not result or len({x['name'] for x in result})!=len(result):raise ValueError('Empty/duplicate tensor metadata')
        return result
    return dict(schema=1,sha256=digest,architecture=architecture,network_group=groups[0],
                inputs=tensors(hef.get_input_vstream_infos(groups[0])),outputs=tensors(hef.get_output_vstream_infos(groups[0])),
                tensor_semantics='UNVERIFIED',cpu_parity='UNVERIFIED',production_approved=False)


class HailoTransport:
    """Synchronous, bounded, single-owner context; all names come from parsed HEF.

    Prepared against official HailoRT 5.x InferModel API, not hardware-verified.
    The caller must serialize calls and supply FLOAT32 host tensors in HEF order.
    """
    def __init__(self,path,expected_metadata,*,experimental=False,runtime=None,cli_output=None):
        if experimental is not True:raise ValueError('Experimental opt-in required')
        if runtime is None:import hailo_platform as runtime
        self.metadata=inspect_hef(path,runtime=runtime,cli_output=cli_output)
        if self.metadata!=expected_metadata:raise ValueError('HEF_METADATA_MISMATCH')
        for tensor in self.metadata['inputs']+self.metadata['outputs']:
            # A shape alone does not describe FCR/packed memory. Fail closed until
            # a separately reviewed transform is supplied, never reinterpret it.
            order=tensor['format_order'].split('.')[-1]
            if order not in ('NHWC','NC'):raise ValueError('BLOCKED_FORMAT_MAPPING: unsupported HEF host memory order')
        self.metadata=copy.deepcopy(self.metadata);self._stack=ExitStack();self._closed=False
        try:
            device=self._stack.enter_context(runtime.VDevice())
            # Read once again and bind exact verified bytes, not a mutable path.
            data=Path(path).read_bytes()
            if hashlib.sha256(data).hexdigest()!=self.metadata['sha256']:raise ValueError('HEF_CHANGED')
            model=device.create_infer_model(data,self.metadata['network_group'])
            for direction in ('inputs','outputs'):
                actual=getattr(model,'input_names' if direction=='inputs' else 'output_names')
                if set(actual)!={x['name'] for x in self.metadata[direction]}:raise ValueError('Runtime tensor names changed')
                for tensor in self.metadata[direction]:
                    stream=getattr(model,'input' if direction=='inputs' else 'output')(tensor['name'])
                    if list(stream.shape)!=tensor['shape']:raise ValueError('Runtime tensor shape changed')
                    stream.set_format_type(runtime.FormatType.FLOAT32)
                    stream.set_format_order(getattr(runtime.FormatOrder,tensor['format_order'].split('.')[-1]))
            self.configured=self._stack.enter_context(model.configure())
        except BaseException:self.close();raise

    def __enter__(self):return self
    def __exit__(self,*exc):self.close()
    def close(self):self._closed=True;self._stack.close()

    def infer(self,inputs,*,timeout_ms=5000):
        if self._closed:raise RuntimeError('Hailo transport closed')
        if type(timeout_ms) is not int or not 1<=timeout_ms<=30000:raise ValueError('Bounded timeout required')
        if set(inputs)!={x['name'] for x in self.metadata['inputs']}:raise ValueError('Exact HEF input names required')
        for tensor in self.metadata['inputs']:
            value=inputs[tensor['name']]
            if value.dtype!=np.float32 or list(value.shape)!=tensor['shape'] or not value.flags.c_contiguous or not np.isfinite(value).all():
                raise ValueError('Expected contiguous finite FLOAT32 HEF-shaped host tensor')
        outputs={tensor['name']:np.empty(tensor['shape'],np.float32) for tensor in self.metadata['outputs']}
        bindings=self.configured.create_bindings(output_buffers=outputs)
        for name,value in inputs.items():bindings.input(name).set_buffer(value)
        self.configured.run([bindings],timeout_ms)
        if not all(np.isfinite(value).all() for value in outputs.values()):raise ValueError('Nonfinite Hailo output')
        return outputs
