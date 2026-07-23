# edge/model/

Đã copy sẵn 2 file model cần thiết cho Orange Pi từ `backend/ai/model/` của
project gốc (nguồn: `backend/ai/requirements.txt`, `backend/ai/core/face_engine.py`):

```
face_detection_yunet_2023mar.onnx   (~227 KB)  — Face Detection (YuNet, chạy qua cv2.dnn)
w600k_mbf.onnx                      (~13 MB)   — Face Recognition (ArcFace/MobileFaceNet,
                                                  chạy qua cv2.dnn.readNetFromONNX, xem
                                                  edge/face_recognizer.py)
```

Không copy 2 model chống giả mạo (`2.7_80x80_MiniFASNetV2.onnx`,
`4_0_0_80x80_MiniFASNetV1SE.onnx`) — chúng chỉ chạy qua `onnxruntime`, không có
wheel/gói apt cho ARMv7 (xem `AIOT/EDGE_DEPLOYMENT.md`, mục 0), và không nằm
trong phạm vi PoC trên Orange Pi.

**Nếu sau này model gốc trong `backend/ai/model/` được cập nhật/huấn luyện
lại**, nhớ copy lại 2 file trên vào đây (hoặc chạy lại
`AIOT/scripts/deploy_edge.sh`, script này luôn lấy bản mới nhất từ
`backend/ai/model/` khi đẩy sang Orange Pi qua SSH/rsync).
