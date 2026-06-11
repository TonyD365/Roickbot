-- Claude Bridge 插件入口：工具栏、状态面板、配对、WebSocket 连接。
-- 传输用 HttpService:CreateWebStreamClient(WebSocket)（Studio 持久双向连接），取代旧的长轮询。

local HttpService = game:GetService("HttpService")

local Config = require(script.Config)
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
local function wsUrl(): string
	return "ws://127.0.0.1:" .. tostring(getPort()) .. "/ws"
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

------------------------------------------------------------------- WebSocket 连接
local client: any = nil -- 当前 WebStreamClient
local generation = 0 -- 每次连接自增，用来识别"过期"连接的回调/重连

-- 通过 WS 发一条 JSON 消息（连接未就绪时静默忽略）。
local function send(tbl: any): boolean
	if not client then
		return false
	end
	local ok = pcall(function()
		client:Send(HttpService:JSONEncode(tbl))
	end)
	return ok
end

local function handleMessage(message: string)
	local ok, m = pcall(function()
		return HttpService:JSONDecode(message)
	end)
	if not ok or type(m) ~= "table" then
		return
	end
	if m.type == "command" then
		local env = m.payload
		setStatus("Running: " .. tostring(env.tool))
		local response = Dispatcher.dispatch(env)
		response.type = "response"
		send(response)
		setStatus("Connected (WebSocket). Last: " .. tostring(env.tool))
	elseif m.type == "handshake_ok" then
		setStatus("Connected (WebSocket). Waiting for commands…")
	end
end

local startConnection -- 前向声明（Closed 回调里重连用）

startConnection = function()
	if not running then
		return
	end
	local token = getToken()
	if token == "" then
		running = false
		refreshButton()
		setStatus("Paste the token from the desktop app first.")
		return
	end
	if not (HttpService :: any).CreateWebStreamClient then
		running = false
		refreshButton()
		setStatus("This Studio build has no WebSocket support. Enable it in File ▸ Beta Features, then reconnect.")
		return
	end

	generation += 1
	local gen = generation
	setStatus("Connecting (WebSocket)…")

	local ok, c = pcall(function()
		return HttpService:CreateWebStreamClient(Enum.WebStreamClientType.WebSocket, {
			Url = wsUrl(),
			Headers = { Authorization = "Bearer " .. token, ["X-Roblox-MCP"] = "1" },
		})
	end)
	if not ok or not c then
		-- 多半是实验性功能未开启；Roblox 没有从代码开启 Beta Feature 的 API，只能引导用户手开。
		setStatus("WebSocket unavailable (" .. tostring(c) .. "). Enable it in File ▸ Beta Features and reconnect.")
		if running then
			task.wait(3)
			if running and gen == generation then
				startConnection()
			end
		end
		return
	end

	client = c

	c.Opened:Connect(function()
		if gen ~= generation then
			return
		end
		send({
			type = "handshake",
			pluginVersion = Config.PluginVersion,
			sessionId = sessionId,
			placeId = game.PlaceId,
			tools = Dispatcher.toolNames(),
		})
		setStatus("Connected (WebSocket). Waiting for commands…")
	end)

	c.MessageReceived:Connect(function(message: string)
		if gen == generation then
			handleMessage(message)
		end
	end)

	c.Error:Connect(function(code: number, errorMessage: string)
		if gen == generation then
			setStatus("WebSocket error " .. tostring(code) .. ": " .. tostring(errorMessage))
		end
	end)

	c.Closed:Connect(function()
		if gen ~= generation then
			return
		end
		client = nil
		if running then
			setStatus("Disconnected — reconnecting…")
			task.wait(1)
			if running and gen == generation then
				startConnection()
			end
		else
			setStatus("Disconnected.")
		end
	end)
end

local function connect()
	if running then
		return
	end
	running = true
	refreshButton()
	startConnection()
end

local function disconnect()
	running = false
	generation += 1 -- 让所有旧回调/重连失效
	refreshButton()
	if client then
		pcall(function()
			client:Close()
		end)
		client = nil
	end
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
					send({
						type = "event",
						event = { type = "runState", state = s, isRunning = RunService:IsRunning() },
					})
				end
			end
		end
	end)

	-- 把运行时报错也推成事件，wait_for_event 可一次等到"出错了"。
	-- 节流：最多每秒 1 条，避免错误风暴。
	local LogService = game:GetService("LogService")
	local lastErrAt = -1
	LogService.MessageOut:Connect(function(message: string, messageType: Enum.MessageType)
		if running and messageType == Enum.MessageType.MessageError then
			local now = os.clock()
			if now - lastErrAt < 1 then
				return
			end
			lastErrAt = now
			send({ type = "event", event = { type = "output", messageType = "Error", message = message } })
		end
	end)
end

-- 已配对（存有 token）则开 Studio 自动连接。
if getToken() ~= "" then
	connect()
end
