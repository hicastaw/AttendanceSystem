import cv2
import numpy as np
import onnxruntime as ort
import os
from datetime import datetime, timedelta

class FaceEngine:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FaceEngine, cls).__new__(cls)
            
            base_dir = os.path.dirname(os.path.abspath(__file__))
            model_path = os.path.join(base_dir, "..", "model")

            cls._instance.detector = cv2.FaceDetectorYN.create(
                model=os.path.join(model_path, "face_detection_yunet_2023mar.onnx"),
                config='',
                input_size=(640, 640),
                score_threshold=0.8,
                nms_threshold=0.3
            ) 

            cls._instance.rec_session = ort.InferenceSession(
                os.path.join(model_path, "w600k_mbf.onnx"),
                providers=['CPUExecutionProvider']
            )
            cls._instance.input_name = cls._instance.rec_session.get_inputs()[0].name
        
        return cls._instance
    
    def align_face(self, image, face_data):
        landmarks = face_data[4:14].reshape((5, 2)).astype(np.float32)
        
        dst = np.array([
            [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
            [41.5493, 92.3655], [70.7299, 92.2041]
        ], dtype=np.float32)

        tform = cv2.getAffineTransform(landmarks[:3], dst[:3])
        return cv2.warpAffine(image, tform, (112, 112))
    
    def extract_face_embedding(self, image):
        h, w, _ = image.shape
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(image)

        if faces is None:
            return None
        
        face = faces[0]
        if face[-1] < 0.8:
            return None
        
        
        aligned_face = self.align_face(image, face)
        
        if self.is_blurry(aligned_face, threshold=100.0):
            return None
        
       
        blob = cv2.dnn.blobFromImage(aligned_face, 1.0/127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)

        net_out = self.rec_session.run(None, {self.input_name: blob})[0]

        embedding = net_out.flatten()
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding /= norm

        return embedding
    
    def calculate_shapeness(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.Laplacian(gray, cv2.CV_64F).var()
    
    def is_blurry(self, image, threshold):
        return self.calculate_shapeness(image) < threshold
    
    def cosine_similarity_general(v1, v2):
        dot_product = np.dot(v1, v2)
        norm_v1 = np.linalg.norm(v1)
        norm_v2 = np.linalg.norm(v2)
        
        if norm_v1 == 0 or norm_v2 == 0:
            return 0.0
            
        return dot_product / (norm_v1 * norm_v2)
