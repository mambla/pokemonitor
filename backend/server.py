import logging
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from analyzer import analyze_post
from db import get_recent_posts, store_post, update_analysis
from telegram import send_alert

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("pokeparse")

app = Flask(__name__)


@app.post("/analyze")
def analyze():
    post = request.get_json(force=True)

    if not post or not post.get("postId"):
        return jsonify({"error": "missing postId"}), 400

    is_new = store_post(post)
    if not is_new:
        logger.info("Post %s already in DB, skipping", post["postId"])
        return jsonify({"postId": post["postId"], "summary": "duplicate", "telegram_sent": False})

    logger.info(
        "Analyzing post %s by %s (%d images)",
        post["postId"],
        post.get("author", "?"),
        len(post.get("images", [])),
    )

    try:
        analysis = analyze_post(post)
    except Exception:
        logger.exception("AI analysis failed for post %s", post["postId"])
        return jsonify({"error": "analysis_failed"}), 500

    summary = analysis.get("summary", "Analyzed")
    logger.info("Post %s: %s", post["postId"], summary)

    try:
        sent = send_alert(post, analysis)
    except Exception:
        logger.exception("Telegram dispatch failed for post %s", post["postId"])
        sent = False

    update_analysis(post["postId"], analysis, sent)

    return jsonify({
        "postId": post["postId"],
        "summary": summary,
        "telegram_sent": sent,
        "analysis": analysis,
    })


@app.get("/posts")
def list_posts():
    limit = request.args.get("limit", 50, type=int)
    posts = get_recent_posts(min(limit, 200))
    return jsonify(posts)


@app.get("/health")
def health():
    has_openai = bool(os.environ.get("OPENAI_API_KEY"))
    has_telegram = bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))

    return jsonify({
        "status": "ok",
        "openai_configured": has_openai,
        "telegram_configured": has_telegram,
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=3847, debug=True)
