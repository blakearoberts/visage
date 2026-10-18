package visage.authorization

import rego.v1

default allow := false

allow if {
    input.client.id == "web-app"
    input.request.resource == data.resources.user_api
    input.subject.email != ""
}

granted_scopes := [scope |
    some scope in input.request.scopes
    scope in data.clients[input.client.id].scopes
]

exchange := {
    "allow": allow,
    "scopes": granted_scopes,
}
