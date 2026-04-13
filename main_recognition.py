from core import FaceEngine
import cv2
import numpy as np

def main():
    cap = cv2.VideoCapture(0)
    face_engine = FaceEngine()

    img_path = #file ảnh
    img1 = cv2.imread(img_path)

    embedding1 = face_engine.extract_face_embedding(img1)

    window_name = 'Điểm danh PTIT'
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    if not cap.isOpened():
        print("Lỗi: Không thể mở camera.")
        return 
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            print("Lỗi: Không thể đọc khung hình.")
            return
        
        cv2.imshow(window_name, frame)

        if cv2.waitKey(10) & 0xFF == ord('q'):
            break
        
        rgb_image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        embedding = face_engine.extract_face_embedding(rgb_image)
        if embedding is not None:
            break

    similarity = face_engine.calculate_similarity(embedding, embedding1)

    print(f"{similarity:.4f}")
    if similarity > 0.50:
        print("Cùng một người")
    else:
        print("Khác người")

    cap.release()
    cv2.destroyAllWindows()

        

if __name__ == "__main__":
    main() 
