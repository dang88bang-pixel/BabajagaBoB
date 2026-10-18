from fastapi.testclient import TestClient
from privacy_avatar.app import app
client=TestClient(app)
def test_health_declares_local_camera_boundary():
    r=client.get("/health"); assert r.status_code==200; assert r.json()["camera_network_upload"] is False
def test_observation_accepts_structured_data_only():
    r=client.post("/api/vision/observation",json={"summary":"person at desk","objects":["person","laptop"],"text":[],"confidence":0.9}); assert r.status_code==200
def test_chat_rejects_raw_camera_fields():
    r=client.post("/api/chat",json={"message":"hello","observation":{"summary":"ok","objects":[],"text":[],"confidence":0.5},"image":"AAAA"}); assert r.status_code==422
def test_observation_rejects_base64_payload():
    r=client.post("/api/vision/observation",json={"summary":"data:image/jpeg;base64,AAAA","objects":[],"text":[],"confidence":0.5}); assert r.status_code==422
