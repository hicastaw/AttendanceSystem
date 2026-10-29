"""Opt-in JPEG frames from one browser camera, held only in RAM on loopback."""
from urllib.parse import urlsplit
import time
import cv2
import numpy as np
import requests

MAX_BYTES=512*1024


def jpeg_dimensions(data):
    if data[:2]!=b'\xff\xd8':raise ValueError('Browser frame is not JPEG')
    offset=2
    while offset+4<=len(data):
        if data[offset]!=255:raise ValueError('Invalid JPEG marker')
        while offset<len(data) and data[offset]==255:offset+=1
        if offset>=len(data):break
        marker=data[offset];offset+=1
        if marker in (0xD8,0xD9,0x01) or 0xD0<=marker<=0xD7:continue
        if offset+2>len(data):break
        length=int.from_bytes(data[offset:offset+2],'big')
        if length<2 or offset+length>len(data):raise ValueError('Invalid JPEG segment')
        if marker in (0xC0,0xC1,0xC2):
            if length<8:raise ValueError('Invalid JPEG dimensions')
            height=int.from_bytes(data[offset+3:offset+5],'big')
            width=int.from_bytes(data[offset+5:offset+7],'big')
            if not 1<=width<=1280 or not 1<=height<=720:raise ValueError('Browser frame exceeds 1280x720')
            return width,height
        offset+=length
    raise ValueError('JPEG dimensions missing')


class BrowserCamera:
    browser_source=True

    def __init__(self,url,key,*,wait_seconds=1.5):
        parsed=urlsplit(url)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Browser camera source must be explicit loopback HTTP')
        self.url,self.key=url,key
        if not 0<=wait_seconds<=2:raise ValueError('Invalid browser wait budget')
        self.wait_seconds=wait_seconds
        self.device='browser-webcam';self.is_opened=False;self.waiting_for_frame=False
        self.owner=None;self.source_changed=False
        self.sequence=0
        self.session=requests.Session();self.session.trust_env=False

    def open(self):
        self.is_opened=True
        return True

    reconnect=open

    def release(self):
        self.is_opened=False

    def read(self):
        self.waiting_for_frame=False
        deadline=time.monotonic()+self.wait_seconds
        while True:
            response=self.session.get(self.url,params={'after':self.sequence},headers={'X-Device-Key':self.key},timeout=2,stream=True)
            if response.status_code!=204:break
            response.close()
            if time.monotonic()>=deadline:
                self.waiting_for_frame=True;return False,None
            time.sleep(.05)
        with response:
            response.raise_for_status()
            sequence=int(response.headers['X-Frame-Sequence'])
            owner=response.headers['X-Camera-Session']
            if len(owner)!=36:raise ValueError('Invalid camera owner session')
            age=float(response.headers['X-Frame-Age-Ms'])
            if sequence<=self.sequence or not 0<=age<=1500:raise ValueError('Stale/repeated browser frame')
            if response.headers.get('Content-Type','').split(';')[0]!='image/jpeg':raise ValueError('Browser source returned non-JPEG')
            data=bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data)>MAX_BYTES:raise ValueError('Browser frame too large')
        width,height=jpeg_dimensions(data)
        frame=cv2.imdecode(np.frombuffer(data,dtype=np.uint8),cv2.IMREAD_COLOR)
        if frame is None or frame.shape!=(height,width,3):raise ValueError('Invalid decoded browser frame')
        self.sequence=sequence
        self.source_changed=self.owner is not None and self.owner!=owner
        self.owner=owner
        return True,frame.copy()
