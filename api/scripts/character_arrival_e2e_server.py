"""只读角色资源验收服务：复用生产资产路由，不打开用户数据库。"""
from pathlib import Path
from types import SimpleNamespace
import argparse
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.assets import router
from app.config import Settings
import uvicorn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.state.settings = Settings.from_env({"mmd_root_dir": str(Path(__file__).resolve().parents[2] / "MMD")})
app.include_router(router)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)
