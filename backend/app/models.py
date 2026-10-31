from typing import Literal

from pydantic import BaseModel


class TemplateEdit(BaseModel):
    """Fields that can change when a template is edited and resubmitted."""
    category: Literal["UTILITY", "MARKETING"]
    body: str
    variable_names: list[str]          # ["date", "time", "venue"], index 0 = {{1}}
    sample_values: dict[str, str]      # {"1": "12 Nov", "2": "10 AM", "3": "Hall A"}
    has_confirm_buttons: bool = True


class TemplateCreate(TemplateEdit):
    name: str
    language: str = "en"
