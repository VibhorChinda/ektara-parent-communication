"""IVR call scripts per parent language. Keep each prompt under ~15 seconds.

{details} is replaced with the campaign values in order, e.g. "12 Nov, 10 AM, Hall A".
Voice names: https://www.twilio.com/docs/voice/twiml/say/text-speech
Have a native speaker check the hi and ta wording before going live.
"""

SCRIPTS = {
    "en": {
        "voice": "Google.en-IN-Standard-A",
        "language": "en-IN",
        "prompt": "Hello, this is a message from your child's school about {details}. "
                  "Press 1 to confirm. Press 2 if you cannot attend.",
        "invalid": "Sorry, that is not a valid choice.",
        "confirmed": "Thank you. Your attendance is confirmed. Goodbye.",
        "declined": "Thank you. We have noted that you cannot attend. Goodbye.",
        "goodbye": "We did not receive your response. Goodbye.",
    },
    "hi": {
        "voice": "Google.hi-IN-Standard-A",
        "language": "hi-IN",
        "prompt": "नमस्ते, यह आपके बच्चे के स्कूल से संदेश है: {details}. "
                  "पुष्टि करने के लिए 1 दबाएँ। अगर आप नहीं आ सकते, तो 2 दबाएँ।",
        "invalid": "माफ़ कीजिए, यह सही विकल्प नहीं है।",
        "confirmed": "धन्यवाद। आपकी उपस्थिति की पुष्टि हो गई है।",
        "declined": "धन्यवाद। हमने नोट कर लिया है कि आप नहीं आ पाएँगे।",
        "goodbye": "हमें आपका जवाब नहीं मिला। धन्यवाद।",
    },
    "ta": {
        "voice": "Google.ta-IN-Standard-C",
        "language": "ta-IN",
        "prompt": "வணக்கம், இது உங்கள் குழந்தையின் பள்ளியிலிருந்து வரும் செய்தி: {details}. "
                  "உறுதிப்படுத்த 1 ஐ அழுத்தவும். வர முடியாவிட்டால் 2 ஐ அழுத்தவும்.",
        "invalid": "மன்னிக்கவும், அது சரியான தேர்வு அல்ல.",
        "confirmed": "நன்றி. உங்கள் வருகை உறுதிசெய்யப்பட்டது.",
        "declined": "நன்றி. நீங்கள் வர முடியாது என்பதை குறித்துக்கொண்டோம்.",
        "goodbye": "உங்கள் பதில் கிடைக்கவில்லை. நன்றி.",
    },
}


def get_script(language: str) -> dict:
    # Languages without a script fall back to English (see README).
    return SCRIPTS.get(language, SCRIPTS["en"])
