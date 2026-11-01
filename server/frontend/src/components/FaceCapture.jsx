import { useEffect, useRef, useState } from 'react';

// Lấy 1 ảnh khuôn mặt từ webcam hoặc từ file, trả về Blob qua onChange.
export default function FaceCapture({ onChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => stopCamera(), []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      setCameraOn(true);
    } catch (err) {
      setError(`Không mở được camera: ${err.message}`);
    }
  }

  function setImage(blob) {
    setPreviewUrl(URL.createObjectURL(blob));
    onChange(blob);
  }

  function capture() {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && setImage(blob), 'image/jpeg', 0.9);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (file) setImage(file);
  }

  return (
    <div>
      <div className="row">
        <button type="button" onClick={startCamera} disabled={cameraOn}>Bật camera</button>
        <button type="button" onClick={capture} disabled={!cameraOn}>Chụp ảnh</button>
        <label className="file-btn">
          Hoặc chọn ảnh từ máy
          <input type="file" accept="image/*" hidden onChange={handleFile} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="preview-row">
        <video ref={videoRef} autoPlay muted playsInline className={cameraOn ? 'media' : 'hidden'} />
        {previewUrl && <img src={previewUrl} alt="Ảnh khuôn mặt" className="media" />}
      </div>
    </div>
  );
}
