-- Phase 3：可控 Bot（充当玩家的测试替身）+ 结构化"视觉"。
-- Bot 是 Workspace 下名为 ClaudeBot 的 Model（极简可行走 rig 或单个传感 Part）。

local Safety = require(script.Parent.Parent.Safety)
local Serialize = require(script.Parent.Parent.Serialize)

local Workspace = game:GetService("Workspace")

local M = {}
local BOT_NAME = "ClaudeBot"

local function toVector3(v: any, default: Vector3): Vector3
	if type(v) == "table" then
		return Vector3.new(v[1] or 0, v[2] or 0, v[3] or 0)
	end
	return default
end

local function getBot(): Instance?
	return Workspace:FindFirstChild(BOT_NAME)
end

local function botOrFail(): Model
	local bot = getBot()
	if not bot then
		Safety.fail("PATH_NOT_FOUND", "No ClaudeBot in the world — call bot_spawn first")
	end
	return bot :: Model
end

local function rootOf(bot: Instance): BasePart
	local root = bot:FindFirstChild("HumanoidRootPart")
	if not root then
		Safety.fail("PROP_ERROR", "Bot has no HumanoidRootPart")
	end
	return root :: BasePart
end

local function eyeOf(bot: Instance, root: BasePart): Vector3
	local head = bot:FindFirstChild("Head")
	return root.Position + Vector3.new(0, if head then 1.5 else 0, 0)
end

function M.bot_spawn(args: any)
	local existing = getBot()
	if existing then
		existing:Destroy()
	end
	local pos = toVector3(args and args.position, Vector3.new(0, 5, 0))

	local model = Instance.new("Model")
	model.Name = BOT_NAME

	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = Vector3.new(2, 2, 1)
	root.CFrame = CFrame.new(pos)
	root.Parent = model

	local rig = (args and args.rig) or "humanoid"
	if rig == "part" then
		root.Anchored = true
		model.PrimaryPart = root
		model.Parent = Workspace
	else
		root.Anchored = false
		root.CanCollide = true
		local head = Instance.new("Part")
		head.Name = "Head"
		head.Size = Vector3.new(1, 1, 1)
		head.CFrame = root.CFrame * CFrame.new(0, 1.5, 0)
		head.Parent = model
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = root
		weld.Part1 = head
		weld.Parent = root
		local hum = Instance.new("Humanoid")
		hum.Parent = model
		model.PrimaryPart = root
		model.Parent = Workspace
	end

	if args and args.lookAt then
		local la = toVector3(args.lookAt, pos + Vector3.new(0, 0, -1))
		root.CFrame = CFrame.lookAt(root.Position, Vector3.new(la.X, root.Position.Y, la.Z))
	end

	return { path = Safety.pathOf(model), rig = rig }
end

function M.bot_despawn()
	local bot = botOrFail()
	local path = Safety.pathOf(bot)
	bot:Destroy()
	return { despawned = path }
end

function M.bot_move(args: any)
	local bot = botOrFail()
	local root = rootOf(bot)
	local hum = bot:FindFirstChildOfClass("Humanoid")

	if args and args.teleport then
		local pos = toVector3(args.to, root.Position)
		bot:PivotTo(CFrame.new(pos) * (root.CFrame - root.CFrame.Position))
		return { teleported = true, position = { pos.X, pos.Y, pos.Z } }
	end

	local target: Vector3
	if args and args.to then
		target = toVector3(args.to, root.Position)
	elseif args and args.by then
		target = root.Position + toVector3(args.by, Vector3.zero)
	else
		Safety.fail("INVALID_ARGS", "bot_move needs to / by / teleport")
	end

	if hum then
		hum:MoveTo(target)
	else
		bot:PivotTo(CFrame.new(target) * (root.CFrame - root.CFrame.Position))
	end
	return { movingTo = { target.X, target.Y, target.Z }, walking = hum ~= nil }
end

function M.bot_look(args: any)
	local bot = botOrFail()
	local root = rootOf(bot)
	if args and args.lookAt then
		local la = toVector3(args.lookAt, root.Position + root.CFrame.LookVector)
		root.CFrame = CFrame.lookAt(root.Position, la)
	elseif args and args.yawDeg then
		root.CFrame = CFrame.new(root.Position) * CFrame.Angles(0, math.rad(args.yawDeg), 0)
	end
	if args and args.pitchDeg ~= nil then
		bot:SetAttribute("pitchDeg", args.pitchDeg)
	end
	local pitch = bot:GetAttribute("pitchDeg") or 0
	return { look = Serialize.toJson(root.CFrame.LookVector), pitchDeg = pitch }
end

function M.bot_state()
	local bot = botOrFail()
	local root = rootOf(bot)
	local hum = bot:FindFirstChildOfClass("Humanoid")
	return {
		path = Safety.pathOf(bot),
		position = Serialize.toJson(root.Position),
		look = Serialize.toJson(root.CFrame.LookVector),
		pitchDeg = bot:GetAttribute("pitchDeg") or 0,
		humanoidState = if hum then tostring(hum:GetState().Name) else nil,
	}
end

function M.bot_see(args: any)
	local bot = botOrFail()
	local root = rootOf(bot)
	local fov = (args and args.fovDeg) or 90
	local range = (args and args.range) or 100
	local hRays = (args and args.hRays) or 24
	local vRays = (args and args.vRays) or 12
	local pitch = math.rad(bot:GetAttribute("pitchDeg") or 0)

	local eye = eyeOf(bot, root)
	local base = CFrame.lookAt(eye, eye + root.CFrame.LookVector)
	local hFov = math.rad(fov)
	local vFov = math.rad(fov * (vRays / math.max(hRays, 1)))

	local rp = RaycastParams.new()
	rp.FilterType = Enum.RaycastFilterType.Exclude
	rp.FilterDescendantsInstances = { bot }

	local seen: { [string]: any } = {}
	local raysHit = 0
	for i = 0, hRays - 1 do
		local yaw = -hFov / 2 + hFov * (i / math.max(hRays - 1, 1))
		for j = 0, vRays - 1 do
			local p = -vFov / 2 + vFov * (j / math.max(vRays - 1, 1)) + pitch
			local dir = (base * CFrame.Angles(p, yaw, 0)).LookVector * range
			local res = Workspace:Raycast(eye, dir, rp)
			if res then
				raysHit += 1
				local inst = res.Instance
				local path = Safety.pathOf(inst)
				local e = seen[path]
				if not e then
					e = {
						path = path,
						name = inst.Name,
						className = inst.ClassName,
						distance = math.round((res.Position - eye).Magnitude * 10) / 10,
						hitPoint = { res.Position.X, res.Position.Y, res.Position.Z },
						rayCoverage = 0,
					}
					if inst:IsA("BasePart") then
						e.position = Serialize.toJson(inst.Position)
						e.size = Serialize.toJson(inst.Size)
						e.color = Serialize.toJson(inst.Color)
						e.material = tostring(inst.Material.Name)
						e.transparency = inst.Transparency
						e.canCollide = inst.CanCollide
					end
					seen[path] = e
				end
				e.rayCoverage += 1
			end
		end
	end

	-- 邻近物体（即使没被射线直接命中也列出）
	local op = OverlapParams.new()
	op.FilterType = Enum.RaycastFilterType.Exclude
	op.FilterDescendantsInstances = { bot }
	local nearby = {}
	for _, part in ipairs(Workspace:GetPartBoundsInRadius(eye, math.min(range, 60), op)) do
		table.insert(nearby, {
			path = Safety.pathOf(part),
			name = part.Name,
			className = part.ClassName,
			distance = math.round((part.Position - eye).Magnitude * 10) / 10,
			position = Serialize.toJson(part.Position),
		})
	end

	local visible = {}
	for _, e in pairs(seen) do
		table.insert(visible, e)
	end

	return {
		bot = {
			position = Serialize.toJson(root.Position),
			look = Serialize.toJson(root.CFrame.LookVector),
			fovDeg = fov,
			range = range,
		},
		visible = visible,
		nearby = nearby,
		summary = {
			visibleCount = #visible,
			nearbyCount = #nearby,
			raysCast = hRays * vRays,
			raysHit = raysHit,
		},
	}
end

return M
