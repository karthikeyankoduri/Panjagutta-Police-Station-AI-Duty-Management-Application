"""Fixed task categories. 'Others' carries a custom header typed by whoever creates the task."""
from __future__ import annotations

from typing import Optional

REGULAR_DUTY = "REGULAR_DUTY"
BANDOBAST = "BANDOBAST"
VIP_MOVEMENT = "VIP_MOVEMENT"
TRAFFIC_DUTY = "TRAFFIC_DUTY"
VEHICLE_CHECKING = "VEHICLE_CHECKING"
OTHERS = "OTHERS"

# Display order is the order of this list.
TASK_CATEGORIES = [
    (REGULAR_DUTY, "Regular Duty"),
    (BANDOBAST, "Bandobast"),
    (VIP_MOVEMENT, "VIP Movement"),
    (TRAFFIC_DUTY, "Traffic Duties"),
    (VEHICLE_CHECKING, "Vehicle Checking"),
    (OTHERS, "Others"),
]
CATEGORY_LABELS = dict(TASK_CATEGORIES)
CUSTOM_TITLE_MAX = 120


def normalise(category: Optional[str], custom_title: Optional[str]) -> tuple[str, Optional[str]]:
    """Validate a category/header pair. Raises ValueError with a user-facing message."""
    code = (category or "").strip().upper()
    if code not in CATEGORY_LABELS:
        raise ValueError("Choose a task category: " + ", ".join(label for _, label in TASK_CATEGORIES))
    title = (custom_title or "").strip()
    if code == OTHERS:
        if not title:
            raise ValueError("Enter a header for tasks in the 'Others' category")
        if len(title) > CUSTOM_TITLE_MAX:
            raise ValueError(f"The header must be at most {CUSTOM_TITLE_MAX} characters")
        return code, title
    return code, None
