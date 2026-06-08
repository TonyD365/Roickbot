-- 实例增删改 handler。

local Safety = require(script.Parent.Parent.Safety)
local Serialize = require(script.Parent.Parent.Serialize)

local M = {}

local function applyProps(inst: Instance, properties: any)
	if not properties then
		return
	end
	for k, v in pairs(properties) do
		local ok, current = pcall(function()
			return (inst :: any)[k]
		end)
		if ok then
			(inst :: any)[k] = Serialize.fromJson(v, current)
		end
	end
end

function M.create_instance(args: any)
	local parent = Safety.resolveOrFail(args.parentPath)
	Safety.assertMutable(parent)
	local ok, inst = pcall(Instance.new, args.className)
	if not ok or not inst then
		Safety.fail("INVALID_CLASS", "Cannot create instance of class: " .. tostring(args.className))
	end
	if args.name then
		inst.Name = args.name
	end
	applyProps(inst, args.properties)
	inst.Parent = parent
	return { path = Safety.pathOf(inst), className = inst.ClassName }
end

function M.delete_instance(args: any, env: any)
	local paths = if type(args.path) == "table" then args.path else { args.path }
	local deleted = {}
	for _, p in ipairs(paths) do
		local inst = Safety.resolveOrFail(p)
		Safety.assertMutable(inst)
		table.insert(deleted, { path = Safety.pathOf(inst), name = inst.Name, className = inst.ClassName })
		inst:Destroy()
	end
	return { count = #deleted, deleted = deleted, dryRun = env.dryRun }
end

function M.clone_instance(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	if not inst.Archivable then
		Safety.fail("PROP_ERROR", "Instance is not Archivable and cannot be cloned")
	end
	local parent: Instance = if args.parentPath then Safety.resolveOrFail(args.parentPath) else inst.Parent
	Safety.assertMutable(parent)
	local clone = inst:Clone()
	clone.Parent = parent
	return { path = Safety.pathOf(clone), className = clone.ClassName }
end

function M.reparent_instance(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	local parent = Safety.resolveOrFail(args.newParentPath)
	Safety.assertMutable(parent)
	inst.Parent = parent
	return { path = Safety.pathOf(inst) }
end

return M
