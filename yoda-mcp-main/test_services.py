import re
import services


def test_book_meal_confirmed_with_reference():
    r = services.book_meal(date="tomorrow", meal_type="lunch")
    assert r["status"] == "confirmed"
    assert re.fullmatch(r"MEAL-\d{4}", r["reference"])
    assert r["date"] == "tomorrow"
    assert r["meal_type"] == "lunch"
    # the spoken message echoes the details back to the senior
    assert "tomorrow" in r["message"]
    assert r["reference"] in r["message"]


def test_book_meal_defaults_to_lunch():
    r = services.book_meal(date="2026-06-11")
    assert r["meal_type"] == "lunch"
