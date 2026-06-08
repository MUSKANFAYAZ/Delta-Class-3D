const mongoose = require("mongoose");

const classroomSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/,
    },
    subject: {
      type: String,
      default: "",
      trim: true,
    },
    timing: {
      type: String,
      default: "",
      trim: true,
    },
    capacity: {
      type: String,
      default: "",
      trim: true,
    },
    info: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    studentAssignments: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    approvedStudentIds: {
      type: [String],
      default: [],
      description: "List of students approved to join the classroom",
    },
    pendingJoinRequests: {
      type: [
        {
          userId: { type: String, trim: true },
          displayName: { type: String, default: "", trim: true },
          createdAt: { type: Date, default: Date.now },
        }
      ],
      default: [],
      description: "Student join requests awaiting teacher approval",
    },
    studentPositions: {
      type: Map,
      of: {
        x: Number,
        z: Number,
      },
      default: new Map(),
    },
    teacherPositions: {
      type: Map,
      of: {
        x: Number,
        z: Number,
      },
      default: new Map(),
    },
    blackboardStrokes: {
      type: Array,
      default: [],
      description: "Array of drawing strokes for the whiteboard",
    },
    discussionFeed: {
      type: Array,
      default: [],
      description: "Stored discussion messages, images, and system events",
    },
    discussionPolls: {
      type: Array,
      default: [],
      description: "Stored discussion poll state",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Classroom", classroomSchema);
