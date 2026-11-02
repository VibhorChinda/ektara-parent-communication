from app.models import TemplateEdit
from app.routers.templates import validate_content, validate_name


def template(body, names=None, samples=None, category="UTILITY"):
    names = names if names is not None else ["date"]
    samples = samples if samples is not None else {"1": "12 Nov"}
    return TemplateEdit(category=category, body=body, variable_names=names, sample_values=samples)


def test_valid_template_has_no_errors():
    assert validate_content(template("The PTM is on {{1}}. Please confirm.")) == []


def test_gap_in_placeholders():
    t = template("On {{1}} and then {{3}} we meet.", ["a", "b"], {"1": "x", "3": "y"})
    assert any("no gaps" in e for e in validate_content(t))


def test_cannot_start_or_end_with_placeholder():
    assert any("start" in e for e in validate_content(template("{{1}} is the PTM day, see you.")))
    assert any("end" in e for e in validate_content(template("The PTM is on {{1}}.")))


def test_adjacent_placeholders():
    t = template("Meet on {{1}} {{2}} please.", ["a", "b"], {"1": "x", "2": "y"})
    assert any("next to each other" in e for e in validate_content(t))


def test_sample_value_required():
    assert any("sample value" in e for e in validate_content(template("The PTM is on {{1}} today.", samples={})))


def test_utility_rejects_promotional_words():
    assert any("promotional" in e for e in validate_content(template("Big sale on {{1}} at school.")))
    assert validate_content(template("Big sale on {{1}} at school.", category="MARKETING")) == []


def test_name_rules():
    assert validate_name("ptm_reminder", "en") == []
    assert validate_name("PTM Reminder", "en") != []
    assert validate_name("ptm", "english") != []
