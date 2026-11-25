"""Validação com as dependências reais no runner com Docker."""

import os
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(os.getenv("GITHUB_ACTIONS") != "true", reason="requer um runner com Docker")
def test_compose(capfd):
    script = Path(__file__).resolve().parents[3] / "scripts" / "validar-container-python.sh"
    with capfd.disabled():
        subprocess.run(["/bin/bash", str(script), "assistente"], check=True)  # noqa: S603
