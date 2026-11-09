from anvil import *

from ._anvil_designer import KvRowTemplate


class KvRow(KvRowTemplate):
    """A fact: item = {k, v}."""

    def __init__(self, **properties):
        super().__init__(**properties)
