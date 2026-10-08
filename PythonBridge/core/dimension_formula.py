"""Bounded decimal arithmetic on raw input-unit values. Never eval user text."""
import ast
import re
from decimal import Decimal, DecimalException, ROUND_HALF_UP, localcontext


def _expression(formula, allow_constant=False, variable_names=None):
    names = frozenset(variable_names) if variable_names is not None else frozenset(("D1","D2","D3"))
    formula = formula.strip()
    if not formula or len(formula) > 200 or not re.fullmatch(r"[A-Z0-9.+*/()\s-]+", formula):
        raise ValueError("Use D1, D2, D3, decimal numbers, parentheses and + - * / only.")
    try:
        tree = ast.parse(formula, mode="eval")
    except (SyntaxError, RecursionError) as exc:
        raise ValueError("Invalid dimension formula.") from exc
    if sum(1 for _ in ast.walk(tree)) > 80:
        raise ValueError("Formula is too complex.")
    variables = set()

    def check(node, depth=0):
        if depth > 16:
            raise ValueError("Formula is too deeply nested.")
        if isinstance(node, ast.Name) and node.id in names:
            variables.add(node.id)
        elif isinstance(node, ast.Constant) and type(node.value) in (int, float):
            source = ast.get_source_segment(formula, node)
            if not re.fullmatch(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", source or ""):
                raise ValueError("Use ordinary decimal numbers only.")
            if Decimal(source) >= Decimal("1e30"):
                raise ValueError("Formula constant is out of range.")
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            check(node.operand, depth + 1)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            check(node.left, depth + 1)
            check(node.right, depth + 1)
        else:
            raise ValueError("Use D1, D2, D3 and + - * / only; functions and powers are not supported.")
    check(tree.body)
    if not variables and not allow_constant:
        raise ValueError("Formula must use at least one defined dimension (D1, D2 or D3).")
    return formula, tree.body, frozenset(variables)


def formula_variables(formula: str, allow_constant=False) -> frozenset[str]:
    return _expression(formula, allow_constant)[2]


def _calculate(formula: str, dimensions: dict[str, Decimal], quantity: str, allow_constant=False, variable_names=None, loss=False) -> Decimal:
    formula, tree, variables = _expression(formula, allow_constant, variable_names)
    missing = variables.difference(dimensions)
    if missing:
        raise ValueError("Enter test values for " + ", ".join(sorted(missing)) + ".")

    def visit(node):
        if isinstance(node, ast.Name):
            value = dimensions[node.id]
        elif isinstance(node, ast.Constant):
            value = Decimal(ast.get_source_segment(formula, node))
        elif isinstance(node, ast.UnaryOp):
            value = visit(node.operand)
            if isinstance(node.op, ast.USub):
                value = -value
        else:
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add):
                value = left + right
            elif isinstance(node.op, ast.Sub):
                value = left - right
            elif isinstance(node.op, ast.Mult):
                value = left * right
            else:
                if right == 0:
                    raise ValueError("Formula divides by zero.")
                value = left / right
        if not value.is_finite() or abs(value) >= Decimal("1e30"):
            raise ValueError("Formula calculation is out of range.")
        return value
    try:
        with localcontext() as context:
            context.prec = 50
            result = visit(tree).quantize(Decimal("0.000000001"), rounding=ROUND_HALF_UP)
            if loss and not 0 <= result <= 100:
                raise ValueError("Calculated Product loss must be from 0 to 100%.")
            if not loss and (result <= 0 or result >= Decimal("1e19")):
                raise ValueError("Calculated " + quantity + " must be positive and fit 19 whole digits and 9 decimals.")
            return result
    except DecimalException as exc:
        raise ValueError("Formula calculation is out of range.") from exc


def area_formula(formula: str, dimensions: dict[str, Decimal]) -> Decimal:
    return _calculate(formula, dimensions, "area")


def volume_formula(formula: str, dimensions: dict[str, Decimal]) -> Decimal:
    return _calculate(formula, dimensions, "volume")


def conversion_formula(formula: str, dimensions: dict[str, Decimal]) -> Decimal:
    """Conversion factors may be constant (for example, 1 piece per EA)."""
    return _calculate(formula, dimensions, "conversion", allow_constant=True)
