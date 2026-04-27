import cv2
import numpy as np
import onnxruntime as ort
import os

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
                score_threshold=0.80,
                nms_threshold=0.3
            ) 

            cls._instance.rec_session = ort.InferenceSession(
                os.path.join(model_path, "w600k_mbf.onnx"),
                providers=['CPUExecutionProvider']
            )
            cls._instance.rec_input_name = cls._instance.rec_session.get_inputs()[0].name

            cls._instance.fas_v2 = ort.InferenceSession(
                os.path.join(model_path, "2.7_80x80_MiniFASNetV2.onnx"),
                providers=['CPUExecutionProvider']
            )
            cls._instance.fas_v1se = ort.InferenceSession(
                os.path.join(model_path, "4_0_0_80x80_MiniFASNetV1SE.onnx"),
                providers=['CPUExecutionProvider']
            )
            cls._instance.fas_input_name = cls._instance.fas_v2.get_inputs()[0].name
        
        return cls._instance
        
    def align_face(self, image, face_data):
        landmarks = face_data[4:14].reshape((5, 2)).astype(np.float32)
        dst = np.array([
            [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
            [41.5493, 92.3655], [70.7299, 92.2041]
        ], dtype=np.float32)
        tform = cv2.getAffineTransform(landmarks[:3], dst[:3])
        return cv2.warpAffine(image, tform, (112, 112))

    def crop_face_for_fas(self, image, face_data, scale):
        x, y, w, h = face_data[:4].astype(int)
        
        center_x = x + w // 2
        center_y = y + h // 2

        size = max(w, h)
        new_size = int(size * scale)

        x1 = center_x - new_size // 2
        y1 = center_y - new_size // 2
        x2 = x1 + new_size
        y2 = y1 + new_size

        img_h, img_w, _ = image.shape

        x1_safe = max(0, x1)
        y1_safe = max(0, y1)
        x2_safe = min(img_w, x2)
        y2_safe = min(img_h, y2)

        cropped = image[y1_safe:y2_safe, x1_safe:x2_safe]

        if cropped.size == 0:
            return cv2.resize(image[y:y+h, x:x+w], (80, 80))

        return cv2.resize(cropped, (80, 80))

    def check_liveness(self, original_image, face_data):
        crop_v2 = self.crop_face_for_fas(original_image, face_data, scale=2.7)
        crop_v1se = self.crop_face_for_fas(original_image, face_data, scale=4.0)
        
        def prepare_blob(img):
            blob = img.astype(np.float32)
            blob = np.expand_dims(blob, axis=0)
            blob = np.transpose(blob, (0, 3, 1, 2)) 
            return blob

        blob_v2 = prepare_blob(crop_v2)
        blob_v1se = prepare_blob(crop_v1se)

        out_v2 = self.fas_v2.run(None, {self.fas_input_name: blob_v2})[0]
        out_v1se = self.fas_v1se.run(None, {self.fas_input_name: blob_v1se})[0]
        
        def softmax(x):
            e_x = np.exp(x - np.max(x))
            return e_x / e_x.sum(axis=1)

        prob_v2 = softmax(out_v2)
        prob_v1se = softmax(out_v1se)
        
        avg_prob = (prob_v2 + prob_v1se) / 2
        liveness_score = avg_prob[0][1] 
        
        is_real = np.argmax(avg_prob) == 1 and liveness_score > 0.60 
        return is_real, float(liveness_score)

    def extract_face_embedding(self, image):
        h, w, _ = image.shape
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(image)

        if faces is None:
            return None, "NO_FACE"
        
        face = faces[0]
        if face[-1] < 0.70:
            return None, "LOW_CONFIDENCE"
        
        aligned_face = self.align_face(image, face)
        
        if self.is_blurry(aligned_face, threshold=100.0):
            return None, "BLURRY_IMAGE"
        
        is_real, score = self.check_liveness(image, face)
        if not is_real:
            return None, "SPOOFING_DETECTED"
                
        embedding = self.get_face_embedding(aligned_face)

        return embedding, "SUCCESS"
        
    def calculate_shapeness(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.Laplacian(gray, cv2.CV_64F).var()
    
    def is_blurry(self, image, threshold=100.0):
        return self.calculate_shapeness(image) < threshold
    
    def get_face_embedding(self, aligned_face):
        blob = cv2.dnn.blobFromImage(
            aligned_face, 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True
        )
        net_out = self.rec_session.run(None, {self.rec_input_name: blob})[0]
        embedding = net_out.flatten()
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding
