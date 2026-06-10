-- 万能逃生舱：运行任意 Luau 代码并返回结果。
-- 不用 loadstring（Run 模式下 loadstring 不可用），改用临时 ModuleScript + require 执行：
-- 把代码塞进一个函数体，这样顶层 local、多语句、return 都能正常工作。

local Safety = require(script.Parent.Parent.Safety)
local Serialize = require(script.Parent.Parent.Serialize)
local Text = require(script.Parent.Parent.Text)
local ServerStorage = game:GetService("ServerStorage")

local M = {}

function M.run_luau(args: any)
	local src = args.source or ""
	-- returnExpression：仅当真是单表达式时才包 return，避免把多语句代码包坏。
	if args.returnExpression and not Text.looksLikeStatements(src) then
		src = "return (" .. src .. ")"
	end

	local module = Instance.new("ModuleScript")
	module.Name = "ClaudeRunLuau"
	module.Source = "return function(...)\n" .. src .. "\nend"
	module.Parent = ServerStorage

	local okReq, fnOrErr = pcall(require, module)
	if not okReq then
		module:Destroy()
		Safety.fail("LUAU_ERROR", "Compile error: " .. tostring(fnOrErr))
	end
	if type(fnOrErr) ~= "function" then
		module:Destroy()
		Safety.fail("LUAU_ERROR", "Internal error wrapping run_luau source")
	end

	local packed = table.pack(pcall(fnOrErr :: any))
	module:Destroy()
	if not packed[1] then
		Safety.fail("LUAU_ERROR", tostring(packed[2]))
	end
	local returns = {}
	for i = 2, packed.n do
		returns[i - 1] = Serialize.toJson(packed[i])
	end
	-- 提醒：代码在插件 VM 中执行（非 server/client 运行时上下文）。
	return { returned = returns, context = "plugin" }
end

return M
