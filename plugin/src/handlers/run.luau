-- 运行 / 测试 handler（RunService 物理仿真，无本地玩家）。

local RunService = game:GetService("RunService")

local M = {}

local function state(): string
	if RunService:IsRunning() then
		return "Running"
	elseif not RunService:IsEdit() then
		return "Paused"
	end
	return "Edit"
end

function M.start_test()
	RunService:Run()
	task.wait() -- 让运行状态切换落定一帧，再读回真实状态。
	local s = state()
	local res: { [string]: any } = {
		requested = "Running",
		state = s,
		isRunning = RunService:IsRunning(),
	}
	if s ~= "Running" then
		res.ok = false
		res.warning = "RunService:Run() did not enter the Running state. "
			.. "Some places require pressing Run/Play in the Studio toolbar once, or HttpService/plugin "
			.. "permissions may be blocking it. Verify with get_run_state before relying on it."
	end
	return res
end

function M.stop_test()
	RunService:Stop()
	return { state = "Edit" }
end

function M.pause_test()
	RunService:Pause()
	return { state = "Paused" }
end

function M.get_run_state()
	return { state = state(), isEdit = RunService:IsEdit(), isRunning = RunService:IsRunning() }
end

return M
