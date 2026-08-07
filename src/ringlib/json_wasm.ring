# ringlib/json_wasm.ring — the JSON surface of the wasm runtime.
#
# Same names, same contract, same OUTPUT BYTES as ringlib/json.ring — but
# the work happens in C (src/rs_json.c, registered by the bridge), because
# Ring copies every string argument onto the VM stack and a pure-Ring codec
# therefore cannot touch a big payload cheaply (docs/HEADROOM_PLAN.md P2).
#
# json.ring stays shipped and untouched: it is the reference this codec is
# held byte-identical to, and the implementation native Ring uses. This file
# is wasm-only glue — rs_jsonencode / rs_jsondecode exist only there.
#
# rs_jsondecode returns [nStatus, vPayload]:
#   1  parsed         -> return the value
#   0  malformed      -> raise() the exact message json.ring would raise
#   2  number edge    -> return number(token): the token goes through Ring's
#                        own number(), so its errors are Ring's own errors

func JsonEncode v
	return rs_jsonencode(v)

func JsonDecode cJson
	aJsnRes = rs_jsondecode(cJson)
	nJsnSt = aJsnRes[1]
	if nJsnSt = 1
		return aJsnRes[2]
	but nJsnSt = 0
		raise(aJsnRes[2])
	ok
	return number(aJsnRes[2])
