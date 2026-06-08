-- 属性读写 handler。

local Safety = require(script.Parent.Parent.Safety)
local Serialize = require(script.Parent.Parent.Serialize)

local COMMON = { "Name", "ClassName", "Archivable" }
local PART_PROPS = {
	"Position", "Size", "Orientation", "CFrame", "Anchored", "CanCollide",
	"Color", "BrickColor", "Material", "Transparency", "Reflectance",
}

local M = {}

-- 读取实例的（部分）属性，序列化成 JSON 值。供 get_properties / view_elements 复用。
function M.readProperties(inst: Instance, props: { string }?)
	local out: { [string]: any } = {}
	local list = props
	if not list then
		list = table.clone(COMMON)
		if inst:IsA("BasePart") then
			for _, p in ipairs(PART_PROPS) do
				table.insert(list, p)
			end
		end
	end
	for _, p in ipairs(list) do
		local ok, v = pcall(function()
			return (inst :: any)[p]
		end)
		if ok then
			out[p] = Serialize.toJson(v)
		end
	end
	out.Path = Safety.pathOf(inst)
	out.ClassName = inst.ClassName
	out.Parent = if inst.Parent then Safety.pathOf(inst.Parent) else nil
	return out
end

function M.get_properties(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertReadable(inst)
	return M.readProperties(inst, args.props)
end

function M.set_properties(args: any, env: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	local applied = {}
	for k, v in pairs(args.properties) do
		local ok, current = pcall(function()
			return (inst :: any)[k]
		end)
		if not ok then
			Safety.fail("PROP_ERROR", "No such property: " .. tostring(k))
		end
		local converted = Serialize.fromJson(v, current)
		local setOk, setErr = pcall(function()
			(inst :: any)[k] = converted
		end)
		if not setOk then
			Safety.fail("PROP_ERROR", "Failed to set " .. tostring(k) .. ": " .. tostring(setErr))
		end
		table.insert(applied, k)
	end
	return { path = Safety.pathOf(inst), applied = applied, dryRun = env.dryRun }
end

return M
