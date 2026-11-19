from app.services.usernames import generate_usernames, normalise_login, username_for


def test_basic_rule():
    assert username_for("PC", "98765 43210") == "pgpc3210"
    assert username_for("HC", "9876507321") == "pghc7321"


def test_inspector_is_insp():
    assert username_for("INSPECTOR", "9000009999") == "pginsp9999"


def test_short_or_missing_phone():
    assert username_for("PC", "") is None
    assert username_for("PC", "123") is None
    out = generate_usernames([(1, "PC", None)])
    assert out[1] == (None, "no-phone")


def test_clash_both_get_five_digits():
    out = generate_usernames([(1, "PC", "9000013210"), (2, "PC", "9000023210"), (3, "HC", "9000013210")])
    assert out[1] == ("pgpc13210", "clash")
    assert out[2] == ("pgpc23210", "clash")
    assert out[3] == ("pghc3210", "")  # different rank, no clash


def test_existing_name_forces_more_digits():
    out = generate_usernames([(1, "PC", "9000013210")], taken=["PGPC3210"])
    assert out[1] == ("pgpc13210", "clash")


def test_identical_phones_get_suffix():
    out = generate_usernames([(1, "PC", "9000013210"), (2, "PC", "9000013210")])
    names = {out[1][0], out[2][0]}
    assert len(names) == 2 and all(n.startswith("pgpc") for n in names)


def test_normalise_login():
    assert normalise_login("  PG PC 3210 ") == "pgpc3210"
