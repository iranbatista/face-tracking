"""O front gera os tipos a partir do OpenAPI: nenhuma resposta pode ficar sem schema."""


def _untyped(schema, components, seen=()):
    """True se o schema (seguindo $ref e estruturas aninhadas) tem um objeto/valor sem tipo."""
    if not schema:
        return True
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        return name not in seen and _untyped(components[name], components, (*seen, name))
    for key in ("anyOf", "oneOf", "allOf"):
        if key in schema:
            return any(_untyped(s, components, seen) for s in schema[key])
    if schema.get("additionalProperties") is True or schema == {"type": "object"}:
        return True
    if isinstance(schema.get("additionalProperties"), dict) and _untyped(
        schema["additionalProperties"], components, seen
    ):
        return True
    if "items" in schema and _untyped(schema["items"], components, seen):
        return True
    return any(_untyped(p, components, seen) for p in schema.get("properties", {}).values())


def test_respostas_json_tem_schema(client):
    spec = client.get("/openapi.json").json()
    components = spec["components"]["schemas"]
    untyped = []
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            for status, response in op["responses"].items():
                if not status.startswith("2"):
                    continue
                json = response.get("content", {}).get("application/json")
                if json is not None and _untyped(json.get("schema", {}), components):
                    untyped.append(f"{method.upper()} {path} {status}")
    assert untyped == []


def test_componentes_nao_sao_objetos_soltos(client):
    components = client.get("/openapi.json").json()["components"]["schemas"]
    bare = [
        name
        for name, s in components.items()
        if s == {}
        or (s.get("type") == "object" and not s.get("properties") and not s.get("additionalProperties"))
    ]
    assert bare == []
    assert "PhotoOut" in components and "$defs" not in components["ProgressOut"]
