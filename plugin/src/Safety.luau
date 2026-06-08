-- 路径解析 + 变更白/黑名单（防止误改 Core 服务等）。

local Safety = {}

-- 硬禁：任何情况下都不允许读/改的顶层服务。
local DENY = {
	CoreGui = true,
	CorePackages = true,
	RobloxPluginGuiService = true,
	RobloxReplicatedStorage = true,
}

-- 允许变更的顶层服务（读取范围更宽，但写入仅限这些子树）。
local ALLOW_MUTATE = {
	Workspace = true,
	ServerStorage = true,
	ReplicatedStorage = true,
	ReplicatedFirst = true,
	ServerScriptService = true,
	StarterGui = true,
	StarterPack = true,
	StarterPlayer = true,
	Lighting = true,
	SoundService = true,
	Teams = true,
}

-- 抛出结构化错误，供 Dispatcher 转成 error 信封。
local function fail(code: string, message: string)
	error({ code = code, message = message }, 0)
end
Safety.fail = fail

-- 找到某实例所在的顶层服务（game 的直接子级）。
local function topService(inst: Instance): Instance?
	local cur = inst
	while cur.Parent and cur.Parent ~= game do
		cur = cur.Parent
	end
	return cur
end

-- 把 "Workspace/Model/Part" 或 "game/Workspace/..." 解析为实例。
function Safety.resolve(path: string): Instance?
	if path == nil or path == "" then
		return nil
	end
	local segments = string.split(path, "/")
	local startIdx = 1
	if segments[1] == "game" or segments[1] == "" then
		startIdx = 2
	end
	local current: Instance = game
	for i = startIdx, #segments do
		local seg = segments[i]
		if seg == "" then
			continue
		end
		if current == game then
			-- 顶层：优先按服务解析。
			local ok, svc = pcall(function()
				return game:GetService(seg :: any)
			end)
			if ok and svc then
				current = svc
			else
				local child = game:FindFirstChild(seg)
				if not child then
					return nil
				end
				current = child
			end
		else
			local child = current:FindFirstChild(seg)
			if not child then
				return nil
			end
			current = child
		end
	end
	if current == game then
		return nil
	end
	return current
end

-- 解析并在失败时报错。
function Safety.resolveOrFail(path: string): Instance
	local inst = Safety.resolve(path)
	if not inst then
		fail("PATH_NOT_FOUND", "No instance at path: " .. tostring(path))
	end
	return inst :: Instance
end

-- 取实例的路径字符串（用斜杠分隔）。
function Safety.pathOf(inst: Instance): string
	local ok, full = pcall(function()
		return inst:GetFullName()
	end)
	if not ok then
		return inst.Name
	end
	return (string.gsub(full, "%.", "/"))
end

-- 读取是否允许（仅挡 Core 服务）。
function Safety.assertReadable(inst: Instance)
	local svc = topService(inst)
	if svc and DENY[svc.Name] then
		fail("PATH_DENIED", "Reading " .. svc.Name .. " is not allowed")
	end
end

-- 变更是否允许（必须落在允许的服务子树内，且不在 deny 内）。
function Safety.assertMutable(inst: Instance)
	local svc = topService(inst)
	if not svc then
		fail("PATH_DENIED", "Cannot mutate the game root")
	end
	if DENY[svc.Name] then
		fail("PATH_DENIED", "Mutating " .. svc.Name .. " is not allowed")
	end
	if not ALLOW_MUTATE[svc.Name] then
		fail("PATH_DENIED", "Mutating " .. svc.Name .. " is not allowed (not in the allow list)")
	end
end

return Safety
