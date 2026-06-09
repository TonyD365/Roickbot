-- Phase 2 做图 handler：建几何体 / 外观 / 地形 / 光照 / 贴图 / 模型 / GUI。

local Safety = require(script.Parent.Parent.Safety)
local Serialize = require(script.Parent.Parent.Serialize)

local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")
local InsertService = game:GetService("InsertService")
local StarterGui = game:GetService("StarterGui")

local M = {}

local function toVector3(v: any, default: Vector3): Vector3
	if type(v) == "table" then
		return Vector3.new(v[1] or 0, v[2] or 0, v[3] or 0)
	end
	return default
end

local function toColor3(v: any): Color3?
	if type(v) == "table" then
		return Color3.fromRGB(v[1] or 0, v[2] or 0, v[3] or 0)
	end
	return nil
end

local function materialEnum(name: string?): EnumItem?
	if not name then
		return nil
	end
	local ok, m = pcall(function()
		return (Enum.Material :: any)[name]
	end)
	return if ok then m else nil
end

function M.build_parts(args: any)
	local created = {}
	for _, spec in ipairs(args.parts) do
		local part = Instance.new("Part")
		if spec.shape then
			local ok, s = pcall(function()
				return (Enum.PartType :: any)[spec.shape]
			end)
			if ok then
				part.Shape = s
			end
		end
		part.Size = toVector3(spec.size, Vector3.new(4, 1, 2))
		local pos = toVector3(spec.position, Vector3.new(0, 0, 0))
		if spec.orientation then
			local o = spec.orientation
			part.CFrame = CFrame.new(pos)
				* CFrame.Angles(math.rad(o[1] or 0), math.rad(o[2] or 0), math.rad(o[3] or 0))
		else
			part.Position = pos
		end
		local c = toColor3(spec.color)
		if c then
			part.Color = c
		end
		local mat = materialEnum(spec.material)
		if mat then
			part.Material = mat
		end
		part.Anchored = if spec.anchored ~= nil then spec.anchored else true
		if spec.name then
			part.Name = spec.name
		end
		local parent = if spec.parentPath then Safety.resolveOrFail(spec.parentPath) else Workspace
		Safety.assertMutable(parent)
		part.Parent = parent
		table.insert(created, Safety.pathOf(part))
	end
	return { count = #created, paths = created, dryRun = args.dryRun }
end

function M.set_appearance(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not inst:IsA("BasePart") then
		Safety.fail("PROP_ERROR", "set_appearance needs a BasePart: " .. Safety.pathOf(inst))
	end
	local part = inst :: BasePart
	local c = toColor3(args.color)
	if c then
		part.Color = c
	end
	local mat = materialEnum(args.material)
	if mat then
		part.Material = mat
	end
	if args.transparency ~= nil then
		part.Transparency = args.transparency
	end
	if args.reflectance ~= nil then
		part.Reflectance = args.reflectance
	end
	if args.castShadow ~= nil then
		part.CastShadow = args.castShadow
	end
	return { path = Safety.pathOf(part) }
end

function M.edit_terrain(args: any)
	local terrain = Workspace.Terrain
	local mat = materialEnum(args.material) or Enum.Material.Grass
	if args.op == "fillBlock" then
		local pos = toVector3(args.position, Vector3.new(0, 0, 0))
		local size = toVector3(args.size, Vector3.new(8, 8, 8))
		terrain:FillBlock(CFrame.new(pos), size, mat)
	elseif args.op == "fillBall" then
		local center = toVector3(args.position, Vector3.new(0, 0, 0))
		terrain:FillBall(center, args.radius or 8, mat)
	elseif args.op == "clear" then
		terrain:Clear()
	else
		Safety.fail("INVALID_ARGS", "Unknown terrain op: " .. tostring(args.op))
	end
	return { op = args.op }
end

function M.set_lighting(args: any)
	local applied = {}
	if args.clearEffects then
		for _, child in ipairs(Lighting:GetChildren()) do
			child:Destroy()
		end
	end
	if args.properties then
		for k, v in pairs(args.properties) do
			local ok, current = pcall(function()
				return (Lighting :: any)[k]
			end)
			if ok then
				local setOk = pcall(function()
					(Lighting :: any)[k] = Serialize.fromJson(v, current)
				end)
				if setOk then
					table.insert(applied, k)
				end
			end
		end
	end
	if args.atmosphere then
		local atmo = Instance.new("Atmosphere")
		for k, v in pairs(args.atmosphere) do
			local ok, current = pcall(function()
				return (atmo :: any)[k]
			end)
			if ok then
				pcall(function()
					(atmo :: any)[k] = Serialize.fromJson(v, current)
				end)
			end
		end
		atmo.Parent = Lighting
	end
	return { applied = applied }
end

function M.insert_decal(args: any)
	local inst = Safety.resolveOrFail(args.path)
	Safety.assertMutable(inst)
	if not inst:IsA("BasePart") then
		Safety.fail("PROP_ERROR", "insert_decal needs a BasePart")
	end
	local decal = Instance.new("Decal")
	decal.Texture = "rbxassetid://" .. tostring(args.assetId)
	if args.face then
		local ok, f = pcall(function()
			return (Enum.NormalId :: any)[args.face]
		end)
		if ok then
			decal.Face = f
		end
	end
	decal.Parent = inst
	return { path = Safety.pathOf(decal) }
end

function M.insert_model(args: any)
	local parent = if args.parentPath then Safety.resolveOrFail(args.parentPath) else Workspace
	Safety.assertMutable(parent)
	local ok, container = pcall(function()
		return InsertService:LoadAsset(tonumber(args.assetId) or 0)
	end)
	if not ok or not container then
		Safety.fail("INSERT_FAILED", "LoadAsset failed for asset " .. tostring(args.assetId))
	end
	local inserted = {}
	for _, child in ipairs(container:GetChildren()) do
		child.Parent = parent
		if args.position and child:IsA("PVInstance") then
			pcall(function()
				(child :: PVInstance):PivotTo(CFrame.new(toVector3(args.position, Vector3.new(0, 0, 0))))
			end)
		end
		table.insert(inserted, Safety.pathOf(child))
	end
	container:Destroy()
	return { count = #inserted, inserted = inserted }
end

local function buildGuiNode(spec: any, parent: Instance): Instance
	local ok, inst = pcall(Instance.new, spec.className)
	if not ok or not inst then
		Safety.fail("INVALID_CLASS", "Cannot create GUI class: " .. tostring(spec.className))
	end
	if spec.name then
		inst.Name = spec.name
	end
	if spec.properties then
		for k, v in pairs(spec.properties) do
			local okp, current = pcall(function()
				return (inst :: any)[k]
			end)
			if okp then
				pcall(function()
					(inst :: any)[k] = Serialize.fromJson(v, current)
				end)
			end
		end
	end
	inst.Parent = parent
	if spec.children then
		for _, childSpec in ipairs(spec.children) do
			buildGuiNode(childSpec, inst)
		end
	end
	return inst
end

function M.build_gui(args: any)
	local parent = if args.parentPath then Safety.resolveOrFail(args.parentPath) else StarterGui
	Safety.assertMutable(parent)
	local root = buildGuiNode(args.tree, parent)
	return { path = Safety.pathOf(root) }
end

return M
