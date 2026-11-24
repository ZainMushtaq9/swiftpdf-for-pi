"""Run the SwiftPDF FastAPI backend on a Hugging Face Gradio-SDK Space.

HF marks Docker Spaces as paid on this account, so the Space runs as a
Gradio-SDK Space and this file starts uvicorn directly on port 7860.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=7860)
