"""
Lightweight Style-Bert-VITS2 API server for Tama.
Exposes the same endpoints that tts-sbv2.ts expects:
  GET /models/info
  GET /voice?text=...&model_id=N&speaker_name=S&style=X&language=JP
"""

import argparse
import io
import wave
from pathlib import Path

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from style_bert_vits2.constants import Languages
from style_bert_vits2.nlp import bert_models
from style_bert_vits2.tts_model import TTSModel

app = FastAPI(title="Tama SBV2 Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

models: dict[int, dict] = {}


def load_models(model_root: Path):
    model_id = 0
    for model_dir in sorted(model_root.iterdir()):
        if not model_dir.is_dir():
            continue
        config = model_dir / "config.json"
        style_vec = model_dir / "style_vectors.npy"
        if not config.exists() or not style_vec.exists():
            continue
        safetensors = sorted(model_dir.glob("*.safetensors"))
        if not safetensors:
            continue
        model_file = safetensors[-1]

        device = "cpu"
        if torch.backends.mps.is_available():
            device = "mps"

        print(f"Loading model: {model_dir.name} ({model_file.name}) on {device}")
        torch.set_default_dtype(torch.float32)
        tts = TTSModel(
            model_path=model_file,
            config_path=config,
            style_vec_path=style_vec,
            device=device,
        )
        tts.load()
        net_g = getattr(tts, "_TTSModel__net_g", None)
        if net_g is not None:
            net_g.float()

        # Use the model's own speaker/style mappings
        spk2id = dict(tts.hyper_parameters.data.spk2id)
        style2id = dict(tts.style2id)

        models[model_id] = {
            "name": model_dir.name,
            "tts": tts,
            "config_path": str(config),
            "model_path": str(model_file),
            "spk2id": spk2id,
            "style2id": style2id,
            "id": model_id,
        }
        model_id += 1

    # Determine device used by models
    device = "cpu"
    if models:
        device = next(iter(models.values()))["tts"].device

    # Preload the Japanese BERT model on same device for speed
    print(f"Preloading Japanese BERT model on {device}...")
    bert = bert_models.load_model(Languages.JP)
    bert.to(device).float()

    # Warm-up pass (first inference is slower due to JIT/caching)
    if models:
        first = next(iter(models.values()))["tts"]
        with torch.no_grad():
            first.infer(text="テスト", language=Languages.JP)
        print("Warm-up complete")

    print(f"Loaded {len(models)} model(s)")


@app.get("/models/info")
async def models_info():
    result = {}
    for mid, m in models.items():
        result[m["name"]] = {
            "config_path": m["config_path"],
            "model_path": m["model_path"],
            "spk2id": m["spk2id"],
            "style2id": m["style2id"],
            "id": m["id"],
        }
    return result


@app.get("/voice")
async def voice(
    text: str = Query(...),
    model_id: int = Query(0),
    speaker_name: str = Query(""),
    style: str = Query("Neutral"),
    language: str = Query("JP"),
):
    if model_id not in models:
        return Response(content="Model not found", status_code=404)

    m = models[model_id]
    tts: TTSModel = m["tts"]

    lang = Languages.JP
    if language.upper() == "EN":
        lang = Languages.EN
    elif language.upper() == "ZH":
        lang = Languages.ZH

    with torch.no_grad():
        sr, audio = tts.infer(
            text=text,
            language=lang,
            style=style,
        )

    # Convert to WAV
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        if audio.dtype == np.int16:
            wf.writeframes(audio.tobytes())
        else:
            audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
            wf.writeframes(audio_int16.tobytes())

    return Response(content=buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--models", type=str, default="sbv2-models")
    args = parser.parse_args()

    load_models(Path(args.models))
    uvicorn.run(app, host="0.0.0.0", port=args.port)
