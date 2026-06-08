-- Studio 选择 handler。

local Safety = require(script.Parent.Parent.Safety)
local Selection = game:GetService("Selection")

local M = {}

function M.get_selection()
	local out = {}
	for _, inst in ipairs(Selection:Get()) do
		table.insert(out, Safety.pathOf(inst))
	end
	return { selection = out }
end

function M.set_selection(args: any)
	local insts = {}
	for _, p in ipairs(args.paths) do
		table.insert(insts, Safety.resolveOrFail(p))
	end
	Selection:Set(insts)
	return { count = #insts }
end

return M
