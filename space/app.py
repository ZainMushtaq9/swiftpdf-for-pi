"""Run the SwiftPDF FastAPI backend on a Hugging Face ZeroGPU Space.

HF marks Docker Spaces as paid on this account, so the Space runs as a
Gradio-SDK Space on free ZeroGPU hardware. ZeroGPU refuses to start a Space
with no @spaces.GPU function, so a bare GPU-marked function is defined
here purely to satisfy that startup check; the real backend is the
FastAPI app served by uvicorn on port 7860. (Mounting a Gradio interface
alongside it made a second server try to bind the same port.)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import spaces  # noqa: F401  (registers the GPU function below)
import uvicorn


@spaces.GPU
def _gpu_probe():
    return "ok"


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=7860)
