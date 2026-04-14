import cv2
from core.face_engine import FaceEngine
from core.ai_worker import AIWorker

def main():
    engine = FaceEngine()
    worker = AIWorker(engine)
    worker.start() 

    cap = cv2.VideoCapture(0)
    window_name = 'Điểm danh PTIT'
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    current_match = None

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break

        worker.submit_frame(frame)

        result = worker.get_result()
        if result:
            current_match = result
            engine.trigger_success()

        cv2.imshow(window_name, frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
