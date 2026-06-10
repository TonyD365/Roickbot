-- HttpService 封装：与本地桥服务器通信（带鉴权头）。

local HttpService = game:GetService("HttpService")

local Net = {}

local function headers(token: string)
	return {
		["Content-Type"] = "application/json",
		["Authorization"] = "Bearer " .. token,
		["X-Roblox-MCP"] = "1",
	}
end

-- 通用请求；RequestAsync 不会因 HTTP 状态码抛错，只在网络层失败时抛错。
local function request(url: string, method: string, token: string, body: any?)
	return HttpService:RequestAsync({
		Url = url,
		Method = method,
		Headers = headers(token),
		Body = if body ~= nil then HttpService:JSONEncode(body) else nil,
	})
end

function Net.handshake(baseUrl: string, token: string, info: any)
	return request(baseUrl .. "/handshake", "POST", token, info)
end

function Net.poll(baseUrl: string, token: string, sessionId: string)
	return request(baseUrl .. "/poll?sessionId=" .. sessionId, "GET", token)
end

function Net.respond(baseUrl: string, token: string, response: any)
	return request(baseUrl .. "/response", "POST", token, response)
end

-- 主动上报事件（如运行状态变化），供 MCP 的 wait_for_event 唤醒。
function Net.event(baseUrl: string, token: string, ev: any)
	return request(baseUrl .. "/event", "POST", token, ev)
end

return Net
