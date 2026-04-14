import threading
import queue
import cv2

class AIWorker:
    def __init__(self, face_engine):
        self.engine = face_engine
        self.input_queue = queue.Queue(maxsize=1)
        self.output_queue = queue.Queue(maxsize=1)
        self.running = True


    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while self.running:
            frame = self.input_queue.get()

            if not self.engine.is_paused():
                rgb_image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                embedding = self.engine.extract_face_embedding(rgb_image)

                if embedding is not None:
                    match = {"name": "Lê Quang Vinh", "student_id": "B25DCCN539", "similarity": 0.62} # sau thay bằng hàm kiểm tra trùng khớp trong database

                    if match is not None:
                        if not self.output_queue.full():
                            self.output_queue.put(match)
                    
                    self.input_queue.task_done()

    def submit_frame(self, frame):
        if not self.input_queue.full():
            self.input_queue.put(frame.copy())

    def get_result(self):
        if not self.output_queue.empty():
            return self.output_queue.get()
        return None
