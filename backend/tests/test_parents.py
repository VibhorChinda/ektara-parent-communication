from app.routers.parents import clean_level, clean_parent, normalize_phone, parse_bool, parse_row


def row(**overrides):
    base = {
        "parent_name": "Asha Rao",
        "phone": "98765 43210",
        "child_name": "Riya Rao",
        "institution": "Sunrise  School",
        "institution_type": "",
        "class_or_year": "Class 7",
        "section": "b",
        "language": "HI",
        "has_whatsapp": "yes",
    }
    return {**base, **overrides}


def test_school_row_is_normalized():
    parent, reason = parse_row(row())
    assert reason is None
    assert parent["phone_e164"] == "+919876543210"
    assert parent["institution"] == "Sunrise School"
    assert parent["institution_type"] == "school"
    assert parent["class_or_year"] == "7"
    assert parent["section"] == "B"
    assert parent["language"] == "hi"
    assert parent["has_whatsapp"] is True


def test_college_year():
    parent, reason = parse_row(row(institution_type="college", class_or_year="2nd year", section=""))
    assert reason is None
    assert parent["class_or_year"] == "2"
    assert parent["section"] is None


def test_college_rejects_bad_year_and_sections():
    assert parse_row(row(institution_type="college", class_or_year="5", section=""))[0] is None
    assert parse_row(row(institution_type="college", class_or_year="1", section="A"))[0] is None


def test_missing_fields_are_rejected():
    assert parse_row(row(institution=""))[1].startswith("institution is empty")
    assert parse_row(row(class_or_year=""))[1] == "class_or_year is empty"
    assert parse_row(row(phone="12"))[0] is None
    assert parse_row(row(institution_type="university"))[0] is None
    assert parse_row(row(has_whatsapp="maybe"))[0] is None


def test_empty_section_means_none():
    assert clean_level("school", "LKG", "") == ("LKG", None, None)


def test_clean_parent_used_by_edit():
    parent, reason = clean_parent("A", "+91 98450 12345", "", "X College", "college", "Year 3", "", "")
    assert reason is None
    assert parent["class_or_year"] == "3"
    assert parent["language"] == "en"


def test_helpers():
    assert normalize_phone("not a phone") is None
    assert parse_bool("") is True
    assert parse_bool("No") is False
