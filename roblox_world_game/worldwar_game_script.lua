-- worldwar_game_script.lua
-- Prototype world conquest game logic for Roblox
-- Place this script as a Script under ServerScriptService
-- It handles leaderstats, zone capturing and awarding points to teams
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

-- Create a leaderstats folder with Points for each player
Players.PlayerAdded:Connect(function(player)
    local leaderstats = Instance.new("Folder")
    leaderstats.Name = "leaderstats"
    leaderstats.Parent = player

    local points = Instance.new("IntValue")
    points.Name = "Points"
    points.Value = 0
    points.Parent = leaderstats
end)

-- Ensure every player who is already in the game has leaderstats
for _, player in ipairs(Players:GetPlayers()) do
    if not player:FindFirstChild("leaderstats") then
        local leaderstats = Instance.new("Folder")
        leaderstats.Name = "leaderstats"
        leaderstats.Parent = player
        local points = Instance.new("IntValue")
        points.Name = "Points"
        points.Value = 0
        points.Parent = leaderstats
    end
end

-- Prepare a table of zones. Zones should be Parts under workspace.Zones
local zones = {}
local zonesFolder = workspace:FindFirstChild("Zones")
if zonesFolder then
    for _, zonePart in ipairs(zonesFolder:GetChildren()) do
        if zonePart:IsA("BasePart") then
            zones[zonePart] = {
                part = zonePart,
                owner = nil,
                progress = 0,
                timeToCapture = 10 -- seconds required to capture this zone
            }
        end
    end
end

-- Helper function to determine which team has the most players in a zone
local function getControllingTeam(counts)
    local controllingTeam = nil
    local maxCount = 0
    for team, count in pairs(counts) do
        if count > maxCount then
            controllingTeam = team
            maxCount = count
        elseif count == maxCount then
            controllingTeam = nil -- tie / contested
        end
    end
    return controllingTeam
end

-- Award points to all players on a team
local function awardTeamPoints(team, amount)
    for _, player in ipairs(Players:GetPlayers()) do
        if player.Team == team then
            local stats = player:FindFirstChild("leaderstats")
            if stats and stats:FindFirstChild("Points") then
                stats.Points.Value = stats.Points.Value + amount
            end
        end
    end
end

-- Heartbeat loop checks zones continuously for capturing
RunService.Heartbeat:Connect(function(dt)
    for _, info in pairs(zones) do
        local zonePart = info.part
        local region = Region3.new(
            zonePart.Position - zonePart.Size * 0.5,
            zonePart.Position + zonePart.Size * 0.5
        )

        -- Collect team counts for players currently inside the zone
        local teamCounts = {}
        local partsInRegion = workspace:FindPartsInRegion3(region, nil, math.huge)
        for _, part in ipairs(partsInRegion) do
            local character = part:FindFirstAncestorOfClass("Model")
            if character and character:FindFirstChildOfClass("Humanoid") then
                local player = Players:GetPlayerFromCharacter(character)
                if player and player.Team then
                    teamCounts[player.Team] = (teamCounts[player.Team] or 0) + 1
                end
            end
        end

        local controllingTeam = getControllingTeam(teamCounts)

        if controllingTeam and controllingTeam ~= info.owner then
            -- Increase progress over time while a new team controls the zone
            info.progress = info.progress + dt
            if info.progress >= info.timeToCapture then
                info.owner = controllingTeam
                -- Change zone color to represent owner
                zonePart.BrickColor = controllingTeam.TeamColor
                -- Award points to team for capturing this zone
                awardTeamPoints(controllingTeam, 10)
                -- Reset progress for the next contested capture
                info.progress = 0
            end
        else
            -- Reset progress if contested or still owned by the same team
            info.progress = 0
        end
    end
end)
