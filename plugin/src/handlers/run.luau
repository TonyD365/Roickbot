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
	return { state = "Running" }
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
