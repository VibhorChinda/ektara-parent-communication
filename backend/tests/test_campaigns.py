from app.routers.campaigns import audience_label, quoted


def test_audience_label():
    assert audience_label("Sunrise School", "school", "7", "B") == "Sunrise School · Class 7 · Section B"
    assert audience_label("City College", "college", "2", None) == "City College · Year 2"
    assert audience_label("Sunrise School", "school", None, None) == "Sunrise School"


def test_quoted_handles_commas_and_quotes():
    assert quoted('7, "A"') == '"7, \\"A\\""'
