-- 万能逃生舱：运行任意 Luau 代码并返回结果。

local Safety = require(script.Parent.Parent.Safety)
local Serialize = require(script.Parent.Parent.Serialize)

local M = {}

function M.run_luau(args: any)
	local src = args.source
	if args.returnExpression then
		src = "return (" .. src .. ")"
	end
	local fn, loadErr = loadstring(src)
	if not fn then
		Safety.fail("LUAU_ERROR", "Compile error: " .. tostring(loadErr))
	end
	local packed = table.pack(pcall(fn :: any))
	if not packed[1] then
		Safety.fail("LUAU_ERROR", tostring(packed[2]))
	end
	local returns = {}
	for i = 2, packed.n do
		returns[i - 1] = Serialize.toJson(packed[i])
	end
	return { returned = returns }
end

return M
