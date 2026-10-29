const $=id=>document.getElementById(id);
let token='',stream=null,session='',generation=0,timer=null,lastVideoTime=-1,count=0;
function stop(){
  generation++;clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());stream=null;
  $('video').srcObject=null;$('start').disabled=false;$('stop').disabled=true;
  $('status').textContent='Camera đã tắt. Không gửi thêm frame.';
}
async function send(current){
  if(current!==generation||!stream)return;
  try{
    const video=$('video');
    if(video.readyState<2||video.currentTime===lastVideoTime){timer=setTimeout(()=>send(current),150);return;}
    lastVideoTime=video.currentTime;
    const canvas=$('canvas'),scale=Math.min(640/video.videoWidth,480/video.videoHeight,1);
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const capturedAt=Date.now();
    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
    if(current!==generation||!image)return;
    const response=await fetch('/__browser-camera/frame',{method:'POST',body:image,headers:{
      'Content-Type':'image/jpeg',Authorization:`Bearer ${token}`,'X-Camera-Session':session,'X-Captured-At':String(capturedAt),
    },signal:AbortSignal.timeout(4000)});
    if(!response.ok){let error;try{error=(await response.json()).message;}catch{}throw new Error(error||`Frame upload HTTP ${response.status}. Đăng nhập lại nếu phiên hết hạn.`);}
    $('sent').textContent=`Đã gửi ${++count} frame · frame ${canvas.width}×${canvas.height} · SCRFD/R50 xử lý trong container.`;
    $('status').textContent='Webcam đang gửi frame. Mở các bước bên dưới trong tab mới.';
  }catch(error){if(current===generation){stop();$('status').textContent=error.message;}return;}
  if(current===generation)timer=setTimeout(()=>send(current),250);
}
$('login').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});
    const value=await response.json();if(!response.ok)throw new Error(value.message||'Đăng nhập thất bại');
    token=value.data.token;$('password').value='';$('login').hidden=true;$('controls').hidden=false;
    $('status').textContent='Đã đăng nhập. Bấm Bật webcam và cho phép trình duyệt dùng camera.';
  }catch(error){$('status').textContent=error.message;}
});
$('start').addEventListener('click',async()=>{
  stop();$('start').disabled=true;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Hãy mở http://localhost:3080 bằng Chrome/Edge để cấp quyền camera.');
    const deviceId=$('camera').value;
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:480},...(deviceId?{deviceId:{exact:deviceId}}:{})}});
    $('video').srcObject=stream;await $('video').play();
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput');
    $('camera').replaceChildren(...devices.map((device,index)=>{const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label||`Camera ${index+1}`;return option;}));
    $('camera').value=stream.getVideoTracks()[0].getSettings().deviceId||'';
    session=crypto.randomUUID();lastVideoTime=-1;count=0;$('stop').disabled=false;send(++generation);
  }catch(error){stop();$('status').textContent=`Không mở được webcam: ${error.message}. Kiểm tra quyền camera và đóng ứng dụng đang giữ camera.`;}
});
$('stop').addEventListener('click',stop);
$('camera').addEventListener('change',()=>{stop();$('status').textContent='Đã chọn camera. Bấm Bật webcam để kết nối.';});
window.addEventListener('pagehide',()=>{stop();token='';});
