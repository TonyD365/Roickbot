-- 脚本源码读写 handler（用 ScriptEditorService）。

local Safety = require(script.Parent.Parent.Safety)
local ScriptEditorService = game:GetService("ScriptEditorService")

local M = {}

function M.get_script_source(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	if not inst:IsA("LuaSourceContainer") then
		Safety.fail("PROP_ERROR", "Not a script: " .. Safety.pathOf(inst))
	end
	local ok, src = pcall(function()
		return ScriptEditorService:GetEditorSource(inst)
	end)
	if not ok then
		local ok2, s2 = pcall(function()
			return (inst :: any).Source
		end)
		if not ok2 then
			Safety.fail("PROP_ERROR", "Cannot read script source")
		end
		src = s2
	end
	return { path = Safety.pathOf(inst), source = src }
end

function M.set_script_source(args: any, env: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not inst:IsA("LuaSourceContainer") then
		Safety.fail("PROP_ERROR", "Not a script: " .. Safety.pathOf(inst))
	end
	-- UpdateSourceAsync 不一定被 ChangeHistory 的 Cancel 回滚，所以 dryRun 时直接不写。
	if env.dryRun then
		return { path = Safety.pathOf(inst), length = #args.source, dryRun = true, note = "Would replace script source" }
	end
	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(inst, function()
			return args.source
		end)
	end)
	if not ok then
		Safety.fail("PROP_ERROR", "UpdateSourceAsync failed: " .. tostring(err))
	end
	return { path = Safety.pathOf(inst), length = #args.source, dryRun = false }
end

return M
