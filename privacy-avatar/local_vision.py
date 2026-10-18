from __future__ import annotations
import base64, os
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
VLM_URL=os.getenv("VLM_URL","http://127.0.0.1:8080/v1/chat/completions")
MODEL=os.getenv("VLM_MODEL","local-vision")
MAX_BYTES=6*1024*1024
app=FastAPI(title="Local Vision Bridge",version="0.1.0")
app.add_middleware(CORSMiddleware,allow_origins=["http://127.0.0.1:8787","http://localhost:8787"],allow_credentials=False,allow_methods=["POST"],allow_headers=["Content-Type"])
@app.get("/health")
async def health(): return {"ok":True,"bind":"127.0.0.1","upstream":VLM_URL}
@app.post("/analyze")
async def analyze(file: UploadFile=File(...)):
    data=await file.read(MAX_BYTES+1)
    if len(data)>MAX_BYTES: raise HTTPException(413,"frame too large")
    if not file.content_type or not file.content_type.startswith("image/"): raise HTTPException(415,"image required")
    encoded=base64.b64encode(data).decode("ascii")
    body={"model":MODEL,"messages":[{"role":"user","content":[{"type":"text","text":"Describe only observable scene facts. Return JSON with keys summary, objects, text, confidence."},{"type":"image_url","image_url":{"url":f"data:{file.content_type};base64,{encoded}"}}]}],"temperature":0,"max_tokens":300}
    try:
        async with httpx.AsyncClient(timeout=30) as client: response=await client.post(VLM_URL,json=body); response.raise_for_status(); result=response.json()
    except Exception as exc: raise HTTPException(502,f"local VLM unavailable: {type(exc).__name__}") from exc
    return {"result":result,"raw_frame_left_local_host":True}
if __name__=="__main__":
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=int(os.getenv("LOCAL_VISION_PORT","8091")))
