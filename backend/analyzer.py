import json
import os

from openai import OpenAI

SYSTEM_PROMPT = """You are a Pokemon trading card expert. Analyze Facebook marketplace posts selling Pokemon cards.

Given the post text and images, extract structured information about the cards being sold or traded.

Respond with valid JSON only, no markdown fences. Use this schema:
{
  "cards": [
    {
      "name": "card name",
      "set": "set name if identifiable",
      "condition": "NM/LP/MP/HP/Unknown",
      "graded": false,
      "grade": null,
      "grading_company": null
    }
  ],
  "listing_type": "sale" | "trade" | "auction" | "buying" | "unknown",
  "lot_or_single": "lot" | "single" | "multiple_singles",
  "price": "price as stated, or null",
  "currency": "currency code or null",
  "summary": "One-line English summary of the listing"
}

Rules:
- If cards are graded (PSA, CGC, BGS, etc.), set graded=true and fill grade and grading_company
- If you can read card names from images, include them even if not in the text
- Post text may be in Hebrew -- translate any relevant info
- If you can't identify specific cards, describe what you see (e.g. "lot of ~20 mixed cards")
- Price may be in ILS (₪/שקל) or USD ($)
- "lot" means multiple cards sold together at one price; "multiple_singles" means individually priced cards"""

USER_PROMPT_TEMPLATE = """Post from: {author}
Group: {group_name}
Post text:
{text}

Facebook image descriptions: {descriptions}

Analyze the cards in this listing."""

MAX_IMAGES = 4


def analyze_post(post: dict) -> dict:
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    user_text = USER_PROMPT_TEMPLATE.format(
        author=post.get("author", "Unknown"),
        group_name=post.get("groupName", "Unknown"),
        text=post.get("text", "(no text)"),
        descriptions="; ".join(post.get("imageDescriptions", [])) or "(none)",
    )

    content: list[dict] = [{"type": "text", "text": user_text}]

    for url in post.get("images", [])[:MAX_IMAGES]:
        content.append({
            "type": "image_url",
            "image_url": {"url": url, "detail": "low"},
        })

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        max_tokens=1024,
        temperature=0.2,
    )

    raw = resp.choices[0].message.content.strip()

    # Strip markdown fences if model ignores the instruction
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw[:-3]

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"summary": raw, "cards": [], "parse_error": True}
