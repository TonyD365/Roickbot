-- Claude Bridge 插件入口：工具栏、状态面板、配对、长轮询循环。

local HttpService = game:GetService("HttpService")

local Config = require(script.Config)
local Net = require(script.Net)
local Dispatcher = require(script.Dispatcher)

local SETTING_TOKEN = "claude_bridge_token"
local SETTING_PORT = "claude_bridge_port"

local running = false
local sessionId = HttpService:GenerateGUID(false)

local function getToken(): string
	return plugin:GetSetting(SETTING_TOKEN) or ""
end
local function getPort(): number
	return tonumber(plugin:GetSetting(SETTING_PORT)) or Config.DefaultPort
end
local function baseUrl(): string
	return Config.DefaultHost .. ":" .. tostring(getPort())
end

------------------------------------------------------------------- UI
local toolbar = plugin:CreateToolbar("Claude Bridge")
local toggleButton = toolbar:CreateButton(
	"Claude Bridge",
	"Open the Claude Bridge panel",
	"rbxasset://textures/ui/GuiImagePlaceholder.png"
)
toggleButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, true, 320, 280, 280, 240)
local widget = plugin:CreateDockWidgetPluginGui("ClaudeBridgePanel", widgetInfo)
widget.Title = "Claude Bridge"

local root = Instance.new("Frame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(46, 46, 46)
root.BorderSizePixel = 0
root.Parent = widget

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.FillDirection = Enum.FillDirection.Vertical
layout.Parent = root

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 10)
padding.PaddingLeft = UDim.new(0, 10)
padding.PaddingRight = UDim.new(0, 10)
padding.Parent = root

local function label(text: string, order: number, color: Color3?): TextLabel
	local l = Instance.new("TextLabel")
	l.Size = UDim2.new(1, 0, 0, 20)
	l.BackgroundTransparency = 1
	l.TextColor3 = color or Color3.fromRGB(230, 230, 230)
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextWrapped = true
	l.Font = Enum.Font.Gotham
	l.TextSize = 13
	l.Text = text
	l.LayoutOrder = order
	l.Parent = root
	return l
end

label("1. Paste the token from the desktop app:", 1)

local tokenBox = Instance.new("TextBox")
tokenBox.Size = UDim2.new(1, 0, 0, 28)
tokenBox.LayoutOrder = 2
tokenBox.PlaceholderText = "token…"
tokenBox.Text = getToken()
tokenBox.ClearTextOnFocus = false
tokenBox.Font = Enum.Font.Code
tokenBox.TextSize = 12
tokenBox.TextColor3 = Color3.fromRGB(230, 230, 230)
tokenBox.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
tokenBox.TextXAlignment = Enum.TextXAlignment.Left
tokenBox.Parent = root

local connectBtn = Instance.new("TextButton")
connectBtn.Size = UDim2.new(1, 0, 0, 32)
connectBtn.LayoutOrder = 3
connectBtn.Font = Enum.Font.GothamMedium
connectBtn.TextSize = 14
connectBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
connectBtn.BackgroundColor3 = Color3.fromRGB(88, 101, 242)
connectBtn.Text = "Connect"
connectBtn.Parent = root

local statusLabel = label("Disconnected.", 4, Color3.fromRGB(170, 170, 170))
statusLabel.Size = UDim2.new(1, 0, 0, 40)

local function setStatus(text: string)
	statusLabel.Text = text
end
local function refreshButton()
	connectBtn.Text = if running then "Disconnect" else "Connect"
end

------------------------------------------------------------------- 轮询
local function pollLoop()
	local backoff = Config.PollBackoffStart
	while running do
		local ok, resp = pcall(Net.poll, baseUrl(), getToken(), sessionId)
		if not ok then
			setStatus("Reconnecting… Is the desktop app running and HttpService enabled?")
			task.wait(backoff)
			backoff = math.min(backoff * 2, Config.PollBackoffMax)
			continue
		end
		backoff = Config.PollBackoffStart
		local code = resp.StatusCode
		if code == 204 then
			setStatus("Connected. Waiting for commands…")
		elseif code == 200 then
			local okDecode, env = pcall(function()
				return HttpService:JSONDecode(resp.Body)
			end)
			if okDecode then
				setStatus("Running: " .. tostring(env.tool))
				local response = Dispatcher.dispatch(env)
				pcall(Net.respond, baseUrl(), getToken(), response)
				setStatus("Connected. Last: " .. tostring(env.tool))
			end
		elseif code == 401 or code == 403 then
			setStatus("Auth failed (" .. tostring(code) .. "). Check the token.")
			running = false
			refreshButton()
		else
			-- 其它状态（如偶发 5xx）：退避后重试，别空转刷爆请求。
			setStatus("Unexpected status: " .. tostring(code) .. " — retrying…")
			task.wait(backoff)
			backoff = math.min(backoff * 2, Config.PollBackoffMax)
		end
	end
end

local function connect()
	if running then
		return
	end
	local token = getToken()
	if token == "" then
		setStatus("Paste the token from the desktop app first.")
		return
	end
	running = true
	refreshButton()
	setStatus("Connecting…")
	task.spawn(function()
		local info = {
			pluginVersion = Config.PluginVersion,
			sessionId = sessionId,
			placeId = game.PlaceId,
			tools = Dispatcher.toolNames(),
		}
		-- 握手带退避重试：单次网络抖动/桌面端刚启动都不该直接放弃。
		local done = false
		local attempt = 0
		while running and not done and attempt < 5 do
			attempt += 1
			local ok, resp = pcall(Net.handshake, baseUrl(), token, info)
			if ok and resp and resp.StatusCode == 200 then
				done = true
			elseif ok and resp and (resp.StatusCode == 401 or resp.StatusCode == 403) then
				-- 鉴权失败不是抖动，重试无意义。
				running = false
				refreshButton()
				setStatus("Handshake rejected (" .. tostring(resp.StatusCode) .. "). Check the token in the app.")
				return
			else
				setStatus("Handshake attempt " .. attempt .. " failed; retrying…")
				task.wait(math.min(2 ^ attempt * 0.5, 8)) -- 1s,2s,4s,8s,8s
			end
		end
		if not done then
			running = false
			refreshButton()
			setStatus("Handshake failed after retries. Check the desktop app is running and HttpService is enabled.")
			return
		end
		pollLoop()
	end)
end

local function disconnect()
	running = false
	refreshButton()
	setStatus("Disconnected.")
end

------------------------------------------------------------------- 事件
tokenBox.FocusLost:Connect(function()
	plugin:SetSetting(SETTING_TOKEN, tokenBox.Text)
end)

connectBtn.Activated:Connect(function()
	if running then
		disconnect()
	else
		connect()
	end
end)

toggleButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

plugin.Unloading:Connect(function()
	running = false
end)

------------------------------------------------------------------- 运行状态监听
-- 监听 Edit/Running/Paused 变化，主动 push 事件（让 wait_for_event 能感知测试结束/状态切换）。
do
	local RunService = game:GetService("RunService")
	local function stateStr(): string
		if RunService:IsRunning() then
			return "Running"
		elseif not RunService:IsEdit() then
			return "Paused"
		end
		return "Edit"
	end
	task.spawn(function()
		local last = stateStr()
		while true do
			task.wait(0.5)
			if running then
				local s = stateStr()
				if s ~= last then
					last = s
					pcall(Net.event, baseUrl(), getToken(), {
						type = "runState",
						state = s,
						isRunning = RunService:IsRunning(),
					})
				end
			end
		end
	end)

	-- 把运行时报错也推成事件，wait_for_event 可一次等到"出错了"。
	-- 节流：最多每秒 1 条，避免错误风暴刷爆 HttpService 把长轮询挤掉（那会导致掉线）。
	local LogService = game:GetService("LogService")
	local lastErrAt = -1
	LogService.MessageOut:Connect(function(message: string, messageType: Enum.MessageType)
		if running and messageType == Enum.MessageType.MessageError then
			local now = os.clock()
			if now - lastErrAt < 1 then
				return
			end
			lastErrAt = now
			pcall(Net.event, baseUrl(), getToken(), { type = "output", messageType = "Error", message = message })
		end
	end)
end

-- 已配对（存有 token）则开 Studio 自动连接。
if getToken() ~= "" then
	connect()
end
