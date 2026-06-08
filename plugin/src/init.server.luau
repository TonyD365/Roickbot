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
			setStatus("Unexpected status: " .. tostring(code))
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
		local info = { pluginVersion = Config.PluginVersion, sessionId = sessionId, placeId = game.PlaceId }
		local ok, resp = pcall(Net.handshake, baseUrl(), token, info)
		if not ok or (resp and resp.StatusCode ~= 200) then
			running = false
			refreshButton()
			setStatus("Handshake failed. Check the desktop app, token, and HttpService.")
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

-- 已配对（存有 token）则开 Studio 自动连接。
if getToken() ~= "" then
	connect()
end
