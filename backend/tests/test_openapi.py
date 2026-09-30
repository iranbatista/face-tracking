"""O front gera os tipos a partir do OpenAPI: nenhuma resposta pode ficar sem schema."""


def _response_schema(spec, path, method):
    content = spec["paths"][path][method]["responses"]["200"].get("content", {})
    return content.get("application/json", {}).get("schema", {})


def test_respostas_json_tem_schema(client):
    spec = client.get("/openapi.json").json()
    untyped = []
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            if "200" not in op["responses"]:
                continue
            schema = _response_schema(spec, path, method)
            content = op["responses"]["200"].get("content", {})
            if "application/json" in content and (
                not schema or schema == {"type": "object"} or schema.get("additionalProperties") is True
            ):
                untyped.append(f"{method.upper()} {path}")
    assert untyped == []
