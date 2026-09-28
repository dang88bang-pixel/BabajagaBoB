from __future__ import annotations
import os
import re
from typing import Annotated
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
TOKEN = os.getenv("PRIVACY_AVATAR_TOKEN", "")
MAX_TEXT = 2000
MAX_ITEMS = 32
app = FastAPI(title="Privacy Avatar Gateway", version="0.1.0", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:8787","http://localhost:8787"], allow_credentials=False, allow_methods=["GET","POST"], allow_headers=["Authorization","Content-Type"])
class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=1200)
    objects: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    text: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    @field_validator("summary")
    @classmethod
    def clean_summary(cls, value: str) -> str:
        if "data:image" in value.lower() or "base64" in value.lower(): raise ValueError("image payloads are forbidden")
        return value.strip()
    @field_validator("objects","text")
    @classmethod
    def clean_items(cls, values: list[str]) -> list[str]:
        for value in values:
            if not isinstance(value,str) or len(value)>300: raise ValueError("observation item too large")
            if re.search(r"data:image|base64",value,re.I): raise ValueError("image payloads are forbidden")
        return [v.strip() for v in values]
class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=MAX_TEXT)
    observation: Observation | None = None
    instructions: str = Field(default="", max_length=MAX_TEXT)
class ChatResponse(BaseModel):
    reply: str
    observation_used: bool
    external_calls: bool = False
def auth(authorization: Annotated[str|None,Header()] = None) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}": raise HTTPException(401,"unauthorized")
def reject_raw_camera(value: object) -> None:
    if isinstance(value,dict):
        forbidden={"image","frame","frames","video","camera","base64","image_url","data_url"}
        if forbidden.intersection(value.keys()): raise HTTPException(415,"raw camera data is local-only")
        for child in value.values(): reject_raw_camera(child)
    elif isinstance(value,list):
        for child in value: reject_raw_camera(child)
@app.get("/health")
async def health(): return {"ok":True,"camera_network_upload":False,"external_calls":False}
@app.post("/api/vision/observation")
async def observation(payload: Observation, _: None = Depends(auth)): return payload
@app.post("/api/chat",response_model=ChatResponse)
async def chat(payload: ChatRequest, _: None = Depends(auth)):
    reject_raw_camera(payload.model_dump())
    context=payload.observation.summary if payload.observation else "keine lokale Bildbeobachtung"
    reply=f"Lokale Beobachtung: {context}. Deine Anfrage: {payload.message.strip()}"
    if payload.instructions.strip(): reply += f" Regeln: {payload.instructions.strip()}"
    return ChatResponse(reply=reply,observation_used=payload.observation is not None)
