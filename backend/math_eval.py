"""Safe evaluation of handwritten arithmetic expressions."""

from __future__ import annotations

import ast
import operator
import re


_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if hasattr(ast, "Num") and isinstance(node, ast.Num):  # py<3.12
        return float(node.n)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval_node(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    raise ValueError("unsupported expression")


def normalize_expression(raw: str) -> str:
    s = re.sub(r"\s+", "", raw or "")
    s = s.replace("×", "*").replace("÷", "/")
    s = re.sub(r"[^0-9+\-*/=().]", "", s)
    return s


def evaluate_expression(raw: str) -> str | None:
    """Return numeric answer string, or None if not evaluable."""
    s = normalize_expression(raw)
    if not s:
        return None
    if "=" in s:
        s = s[: s.index("=")]
    if not s:
        return None
    if not re.fullmatch(r"[\d+\-*/().]+", s):
        return None
    try:
        tree = ast.parse(s, mode="eval")
        value = _eval_node(tree.body)
        if not isinstance(value, (int, float)) or not (value == value and abs(value) != float("inf")):
            return None
        rounded = round(value * 1000) / 1000
        if abs(rounded - round(rounded)) < 1e-9:
            return str(int(round(rounded)))
        return str(rounded).rstrip("0").rstrip(".")
    except Exception:
        return None
