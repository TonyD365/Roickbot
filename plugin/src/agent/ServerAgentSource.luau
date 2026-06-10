-- 运行时 server-agent 的源码（作为字符串）。start_test 时被插件注入到 ServerScriptService，
-- 游戏一跑就作为真正的服务器脚本执行：连回本地桥（role=agent 通道），在 server 上下文里
-- 执行 run_luau / fire_signal。stop_test 时随运行态销毁、并由插件清理。
--
-- 用长括号字符串保存；其中的 "\n" 等转义在 agent 被 Roblox 编译时才生效（这里只是字面文本）。

local M = {}

M.source = [==[
local HttpService = game:GetService("HttpService")
local ServerScriptService = game:GetService("ServerScriptService")

local self = script
local token = tostring(self:GetAttribute("ClaudeToken"))
local port = self:GetAttribute("ClaudePort")
local session = self:GetAttribute("ClaudeSession") or HttpService:GenerateGUID(false)
local base = "http://127.0.0.1:" .. tostring(port)
local headers = {
	["Content-Type"] = "application/json",
	["Authorization"] = "Bearer " .. token,
	["X-Roblox-MCP"] = "1",
}

local function req(path, method, body)
	return HttpService:RequestAsync({
		Url = base .. path,
		Method = method,
		Headers = headers,
		Body = if body ~= nil then HttpService:JSONEncode(body) else nil,
	})
end

local function resolve(path)
	if not path or path == "" then
		return nil
	end
	local segs = string.split(path, "/")
	local i = 1
	if segs[1] == "game" or segs[1] == "" then
		i = 2
	end
	local cur = game
	for j = i, #segs do
		local s = segs[j]
		if s ~= "" then
			if cur == game then
				local ok, svc = pcall(function()
					return game:GetService(s)
				end)
				cur = if ok and svc then svc else cur:FindFirstChild(s)
			else
				cur = cur:FindFirstChild(s)
			end
			if not cur then
				return nil
			end
		end
	end
	return cur
end

local function ser(v)
	local t = typeof(v)
	if t == "nil" or t == "number" or t == "boolean" or t == "string" then
		return v
	elseif t == "Vector3" then
		return { x = v.X, y = v.Y, z = v.Z }
	elseif t == "Instance" then
		return v:GetFullName()
	end
	return tostring(v)
end

local handlers = {}

function handlers.run_luau(args)
	local src = args.source or ""
	if args.returnExpression and not string.find(src, "[\n;]") then
		src = "return (" .. src .. ")"
	end
	local m = Instance.new("ModuleScript")
	m.Name = "ClaudeAgentRun"
	m.Source = "return function(...)\n" .. src .. "\nend"
	m.Parent = ServerScriptService
	local okR, fn = pcall(require, m)
	if not okR then
		m:Destroy()
		error("Compile error: " .. tostring(fn), 0)
	end
	local packed = table.pack(pcall(fn))
	m:Destroy()
	if not packed[1] then
		error(tostring(packed[2]), 0)
	end
	local rets = {}
	for i = 2, packed.n do
		rets[i - 1] = ser(packed[i])
	end
	return { returned = rets, context = "server", isServer = game:GetService("RunService"):IsServer() }
end

function handlers.fire_signal(args)
	local inst = resolve(args.path)
	if not inst then
		error("PATH_NOT_FOUND: " .. tostring(args.path), 0)
	end
	local method = args.method
	if not method then
		error("method is required", 0)
	end
	local fn = (inst :: any)[method]
	if type(fn) ~= "function" then
		error("No such method '" .. tostring(method) .. "' on " .. inst.ClassName, 0)
	end
	local callArgs = args.args or {}
	local packed = table.pack(pcall(fn, inst, table.unpack(callArgs)))
	if not packed[1] then
		error(tostring(packed[2]), 0)
	end
	local rets = {}
	for i = 2, packed.n do
		rets[i - 1] = ser(packed[i])
	end
	return { path = inst:GetFullName(), method = method, returned = rets }
end

local function dispatch(env)
	local h = handlers[env.tool]
	if not h then
		return { id = env.id, ok = false, error = { code = "UNKNOWN_TOOL", message = "Agent has no handler for " .. tostring(env.tool) } }
	end
	local ok, res = pcall(h, env.args or {})
	if ok then
		return { id = env.id, ok = true, result = res }
	end
	return { id = env.id, ok = false, error = { code = "AGENT_ERROR", message = tostring(res) } }
end

pcall(req, "/handshake", "POST", { role = "server-agent", sessionId = session, pluginVersion = "agent" })

while true do
	local ok, resp = pcall(req, "/poll?role=agent&sessionId=" .. session, "GET")
	if not ok then
		task.wait(0.5)
	else
		local code = resp.StatusCode
		if code == 200 then
			local okD, env = pcall(function()
				return HttpService:JSONDecode(resp.Body)
			end)
			if okD then
				local response = dispatch(env)
				pcall(req, "/response", "POST", response)
			end
		elseif code ~= 204 then
			task.wait(0.5)
		end
	end
end
]==]

return M
