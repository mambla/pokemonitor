import os
import logging

import requests

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org/bot{token}"


def send_alert(post: dict, analysis: dict) -> bool:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    base = API_BASE.format(token=token)

    caption = _format_caption(post, analysis)
    images = post.get("images", [])

    if images:
        return _send_photo(base, chat_id, images[0], caption)
    else:
        return _send_message(base, chat_id, caption)


def _format_caption(post: dict, analysis: dict) -> str:
    group = post.get("groupName", "Unknown Group")
    author = post.get("author", "Unknown")
    link = post.get("postLink", "")

    summary = analysis.get("summary", "No summary")
    listing_type = analysis.get("listing_type", "unknown")
    lot_or_single = analysis.get("lot_or_single", "unknown")
    price = analysis.get("price")
    currency = analysis.get("currency", "")

    cards = analysis.get("cards", [])
    card_lines = []
    for c in cards[:8]:
        parts = [c.get("name", "Unknown")]
        if c.get("set"):
            parts.append(f"({c['set']})")
        if c.get("graded"):
            parts.append(f"[{c.get('grading_company', '?')} {c.get('grade', '?')}]")
        elif c.get("condition") and c["condition"] != "Unknown":
            parts.append(f"[{c['condition']}]")
        card_lines.append(" ".join(parts))

    if len(cards) > 8:
        card_lines.append(f"... +{len(cards) - 8} more")

    price_str = f"{price} {currency}".strip() if price else "Not listed"

    lines = [
        f"🃏 NEW LISTING — {group}",
        "—" * 20,
    ]

    if card_lines:
        lines.append("Cards: " + ", ".join(card_lines))

    lines.extend([
        f"Type: {listing_type} ({lot_or_single})",
        f"Price: {price_str}",
        f"Seller: {author}",
        "—" * 20,
        summary,
    ])

    if link:
        lines.append(f"\n🔗 {link}")

    return "\n".join(lines)


def _send_photo(base: str, chat_id: str, photo_url: str, caption: str) -> bool:
    # Telegram captions max 1024 chars
    if len(caption) > 1024:
        caption = caption[:1021] + "..."

    resp = requests.post(
        f"{base}/sendPhoto",
        json={
            "chat_id": chat_id,
            "photo": photo_url,
            "caption": caption,
            "parse_mode": "HTML",
        },
        timeout=15,
    )

    if not resp.ok:
        logger.error("Telegram sendPhoto failed: %s %s", resp.status_code, resp.text)
        # Fallback to text-only if photo fails (URL might be expired)
        return _send_message(base, chat_id, caption)

    return True


def _send_message(base: str, chat_id: str, text: str) -> bool:
    if len(text) > 4096:
        text = text[:4093] + "..."

    resp = requests.post(
        f"{base}/sendMessage",
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=15,
    )

    if not resp.ok:
        logger.error("Telegram sendMessage failed: %s %s", resp.status_code, resp.text)
        return False

    return True
